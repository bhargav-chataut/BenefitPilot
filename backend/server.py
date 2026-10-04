"""Local BenefitPilot server with PDF/text treatment extraction."""

from __future__ import annotations

import cgi
import argparse
import errno
import hmac
import itertools
import json
import logging
import math
import os
import re
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MOCK_DATABASE_DIR = ROOT / "mock_lincoln_insurance_database"
EMPLOYEES_SQL = MOCK_DATABASE_DIR / "employees.sql"
EMPLOYEE_RE = re.compile(
    r"\('([^']+)','[^']*','[^']*','([^']+)','([^']+)'",
)
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
logger = logging.getLogger("benefitpilot")
logging.basicConfig(
    level=os.environ.get("BENEFITPILOT_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


load_dotenv()

CODE_RE = re.compile(r"\b(D\d{4})\b", re.IGNORECASE)
NPI_RE = re.compile(r"\bNPI(?:\s*(?:#|number))?\s*:?\s*(\d{10})\b", re.IGNORECASE)
MONEY_RE = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")
PROCEDURE_RE = re.compile(
    r"^\s*(D\d{4})\s+(.+?)\s+\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)


def _category(code: str, name: str) -> str:
    code = code.upper()
    lowered = name.lower()
    if "orthodont" in lowered or "braces" in lowered:
        return "orthodontic"
    if code in {"D0120", "D0140", "D0150", "D0210", "D0274", "D1110"}:
        return "preventive"
    if "crown" in lowered or "bridge" in lowered or "implant" in lowered:
        return "major"
    return "basic"


def _clean_manual_name(name: str) -> str:
    name = re.sub(r"\s*\(\s*N/?A\s*\)\s*", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\bN/?A\b", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip(" -:,.()–—")
    lowered = name.lower()
    for keyword, canonical in (
        ("crown", "Crown"),
        ("filling", "Filling"),
        ("cavity", "Filling"),
        ("cleaning", "Cleaning"),
        ("prophylaxis", "Cleaning"),
        ("extraction", "Tooth extraction"),
        ("implant", "Implant"),
        ("bridge", "Bridge"),
        ("root canal", "Root canal"),
    ):
        if keyword in lowered:
            return canonical
    return name


def _name_for_cost(text: str, cost: float, fallback: str) -> str:
    amount = f"{cost:,.2f}".replace(".00", "")
    for line in text.splitlines():
        if amount in line or f"{cost:g}" in line:
            before_cost = re.split(r"\$", line, maxsplit=1)[0]
            code_match = CODE_RE.search(before_cost)
            if code_match:
                before_cost = before_cost.replace(code_match.group(0), "")
            cleaned = re.sub(r"\s+", " ", before_cost).strip(" -:,.()–—")
            if cleaned:
                mapped = _clean_manual_name(cleaned)
                if mapped != cleaned or not re.search(
                    r"\b(?:said|maybe|probably|around|need|have|the|on|one|and)\b",
                    mapped,
                    re.IGNORECASE,
                ):
                    return mapped
    return _clean_manual_name(fallback)


def _procedure_from_line(line: str) -> dict | None:
    match = PROCEDURE_RE.match(line)
    if not match:
        return None
    code, raw_name, raw_cost = match.groups()
    name = _clean_manual_name(re.sub(r"\s+", " ", raw_name).strip(" -:–—"))
    if not name:
        return None
    return {
        "name": name,
        "code": code.upper(),
        "category": _category(code, name),
        "cost": round(float(raw_cost.replace(",", "")), 2),
    }


def optimize_response(payload: dict) -> dict:
    procedures = payload.get("procedures")
    if not isinstance(procedures, list) or not procedures:
        raise ValueError("At least one procedure is required.")
    employee = load_employee(payload.get("employeeEmail"))
    settings = normalize_settings(payload.get("settings"))
    options = build_options(procedures, employee, settings)
    options, explanation = add_ai_recommendation(options)
    return {
        "provider": payload.get("provider", "Your dental provider"),
        "providerDetails": payload.get("providerDetails"),
        "date": payload.get("date", date.today().strftime("%b %-d, %Y")),
        "dentist": payload.get("dentist", "Your dental provider"),
        "months": ["Oct", "Nov", "Dec", "Jan"],
        "procedures": procedures,
        "pricing": payload.get("pricing"),
        "insurance": insurance_info(employee),
        "enrolled_plan": employee["enrolled_plan"],
        "settings": settings,
        "options": options,
        "explanation": explanation,
    }


def extract_procedures(text: str) -> list[dict]:
    procedures = []
    in_table = False
    for line in text.splitlines():
        if line.strip().lower() == "procedures":
            in_table = True
            continue
        if in_table and line.strip().lower() == "financial summary":
            break
        if in_table:
            procedure = _procedure_from_line(line)
            if procedure:
                procedures.append(procedure)

    if procedures:
        return procedures

    # Manual text is intentionally tolerant: one procedure per line is
    # preferred, but sentences containing a CDT code and price also work.
    for line in text.splitlines():
        code_match = CODE_RE.search(line)
        money_match = MONEY_RE.search(line)
        if not money_match:
            continue
        raw_name = line[: money_match.start()]
        if code_match:
            raw_name = raw_name.replace(code_match.group(0), "")
        name = _clean_manual_name(
            re.sub(r"\s+", " ", raw_name).strip(" -:,.()–—")
        )
        if name:
            procedures.append(
                {
                    "name": name,
                    "code": code_match.group(1).upper() if code_match else "",
                    "category": _category(
                        code_match.group(1) if code_match else "", name
                    ),
                    "cost": round(float(money_match.group(1).replace(",", "")), 2),
                }
            )
    return procedures


def groq_extract(text: str) -> list[dict] | None:
    api_key = os.environ.get("GROQ_API_KEY", "").strip().strip("\"'")
    if not api_key:
        print("Groq extraction skipped: GROQ_API_KEY is not configured.", file=sys.stderr)
        return None
    model = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
    prompt = """You are extracting dental treatment information from messy patient-written text.

Identify ONLY actual dental procedures, treatments, or diagnostic services.
Do not extract budgets, insurance limits, preferences, scheduling preferences,
general comments, symptoms by themselves, or dollar amounts not tied to a
dental procedure.

Valid procedures include fillings, crowns, cleanings, x-rays, root canals,
extractions, implants, bridges, dentures, deep cleaning/scaling and root planing,
exams, and fluoride treatments.

Return ONLY valid JSON in exactly this shape:
{"procedures":[{"procedure_name":"string","tooth_number":null,"estimated_cost":null,"cost_min":null,"cost_max":null,"quantity":1,"urgency":"unknown","can_delay":null,"notes":"string"}]}

Rules:
- If two cavities need fillings, return one filling object with quantity 2.
- For a price range, set cost_min and cost_max and use its midpoint as estimated_cost.
- Only include a tooth number when explicitly stated.
- Never invent prices, tooth numbers, CDT codes, or treatments.
- If a service has no price, estimated_cost must be null.
- Include uncertain real services such as "maybe x-rays", with a note.
- urgency must be urgent, soon, routine, or unknown.
- can_delay must be true, false, or null.
- notes must contain only a short treatment-specific note.

TEXT:
""" + text
    request = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(
            {
                "model": model,
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": "You extract structured dental treatment data.",
                    },
                    {"role": "user", "content": prompt},
                ],
            }
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "BenefitPilot/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        content = payload["choices"][0]["message"]["content"]
        procedures = json.loads(content).get("procedures")
        if not isinstance(procedures, list) or not procedures:
            return None
        normalized = []
        for procedure in procedures:
            name = str(
                procedure.get("procedure_name", procedure.get("name", ""))
            ).strip()
            if not name:
                continue
            code = str(procedure.get("code", "")).upper()
            raw_cost = procedure.get("estimated_cost")
            if raw_cost is None:
                raw_min = procedure.get("cost_min")
                raw_max = procedure.get("cost_max")
                if raw_min is not None and raw_max is not None:
                    raw_cost = (float(raw_min) + float(raw_max)) / 2
            cost = float(raw_cost) if raw_cost is not None else 0
            if cost < 0:
                continue
            name = _name_for_cost(text, cost, name)
            category = _category(code, name)
            quantity = max(1, int(procedure.get("quantity", 1)))
            normalized.append(
                {
                    "name": name,
                    "code": code if CODE_RE.fullmatch(code) else "",
                    "category": category,
                    "cost": round(cost, 2),
                    "quantity": quantity,
                    "toothNumber": procedure.get("tooth_number"),
                    "urgency": procedure.get("urgency", "unknown"),
                    "canDelay": procedure.get("can_delay"),
                    "notes": procedure.get("notes", ""),
                }
            )
        if not normalized:
            print("Groq extraction returned no usable procedures; using local parser.", file=sys.stderr)
            return None
        print(
            f"Groq extraction succeeded: {len(normalized)} procedure(s) using {model}.",
            file=sys.stderr,
        )
        return normalized
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        print(
            f"Groq extraction request failed ({error.code}): {detail}; using local parser.",
            file=sys.stderr,
        )
        return None
    except (
        KeyError,
        TypeError,
        ValueError,
        urllib.error.URLError,
        TimeoutError,
    ):
        print("Groq extraction response could not be parsed; using local parser.", file=sys.stderr)
        return None


def groq_recommend_options(options: list[dict]) -> tuple[str | None, str]:
    api_key = os.environ.get("GROQ_API_KEY", "").strip().strip("\"'")
    if not api_key:
        print("Groq explanation skipped: GROQ_API_KEY is not configured.", file=sys.stderr)
        return None, ""
    computed = [
        {
            "id": option["id"],
            "name": option["name"],
            "totalOutOfPocket": option["youPay"],
            "highestMonthlyPayment": option["peakMonthlyPayment"],
            "completionMonth": option["completionMonth"],
            "totalDelayMonths": max(option["schedule"]),
            "usesNextBenefitYear": option["scenario"]["in"]["nextYearUsed"] > 0,
            "nextYearBenefitUsed": option["scenario"]["in"]["nextYearUsed"],
            "remainingCurrentYearBenefit": option["benefitRemaining"],
            "monthlyBudget": option["monthlyBudget"],
            "withinMonthlyBudget": option["peakMonthlyPayment"] <= option["monthlyBudget"],
            "planPays": option["planPays"],
        }
        for option in options
    ]
    by_id = {item["id"]: item for item in computed}
    for item in computed:
        item["differenceVsFastest"] = round(
            item["totalOutOfPocket"] - by_id["premium"]["totalOutOfPocket"], 2
        )
        item["differenceVsBudget"] = round(
            item["totalOutOfPocket"] - by_id["budget"]["totalOutOfPocket"], 2
        )
    prompt = """Choose the best recommendation from the three computed dental
treatment strategies below, then explain why it beats the alternatives for
this user. You may only choose one supplied strategy ID. Compare the options
in this exact order: total estimated out-of-pocket cost; highest estimated
monthly payment; completion month and total delay; whether the schedule uses
the next benefit year; remaining current-year benefit; whether it stays within
the monthly budget; and cost difference versus Fastest and Budget.
Write exactly 2 or 3 concise sentences. Mention exact dollar or timing
differences when meaningful. If two options cost the same, explain the timing
or monthly-payment difference. Say directly when Budget is cheaper because
treatment moves into the next benefit year, when Fastest has no financial
penalty, or how Balanced improves affordability or timing. Do not make medical
claims or suggest delaying care for clinical reasons. Use only supplied values;
do not recalculate, correct, or invent numbers. Return only JSON:
{"recommendationId":"budget|balanced|premium","explanation":"2-3 concise sentences."}

COMPUTED STRATEGIES:
""" + json.dumps(computed, separators=(",", ":"))
    request = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(
            {
                "model": os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b"),
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You explain precomputed dental plan results. "
                            "Never perform optimization or change numbers."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
            }
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "BenefitPilot/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        content = payload["choices"][0]["message"]["content"]
        result = json.loads(content)
        explanation = result.get("explanation")
        if not isinstance(explanation, str) or not explanation.strip():
            print("Groq recommendation returned no usable explanation.", file=sys.stderr)
            return None, ""
        recommendation_id = result.get("recommendationId")
        valid_ids = {option["id"] for option in options}
        if recommendation_id not in valid_ids:
            print(
                "Groq recommendation returned an invalid option; using deterministic recommendation.",
                file=sys.stderr,
            )
            return None, ""
        print(
            f"Groq recommendation succeeded: {recommendation_id}.",
            file=sys.stderr,
        )
        return recommendation_id, explanation.strip()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        print(f"Groq recommendation request failed ({error.code}): {detail}", file=sys.stderr)
        return None, ""
    except (
        KeyError,
        TypeError,
        ValueError,
        urllib.error.URLError,
        TimeoutError,
    ):
        print(
            "Groq recommendation response could not be parsed; using deterministic recommendation.",
            file=sys.stderr,
        )
        return None, ""


def add_ai_recommendation(options: list[dict]) -> tuple[list[dict], str]:
    deterministic = next(option for option in options if option["recommended"])
    recommendation_id, explanation = groq_recommend_options(options)
    if recommendation_id:
        options = [
            {**option, "recommended": option["id"] == recommendation_id}
            for option in options
        ]
        recommended = next(option for option in options if option["id"] == recommendation_id)
    else:
        recommended = deterministic
    if explanation:
        return options, explanation
    by_id = {option["id"]: option for option in options}
    budget = by_id["budget"]
    fastest = by_id["premium"]
    balanced = by_id["balanced"]
    cost_difference = recommended["youPay"] - fastest["youPay"]
    budget_difference = recommended["youPay"] - budget["youPay"]
    next_year = recommended["scenario"]["in"]["nextYearUsed"] > 0
    next_year_text = (
        f"uses {_money(recommended['scenario']['in']['nextYearUsed']):,} of next-year benefits"
        if next_year
        else "uses no next-year benefits"
    )
    return options, (
        f"{recommended['name']} is recommended at ${recommended['youPay']:,.0f} out of pocket "
        f"(Budget ${budget['youPay']:,.0f}, Balanced ${balanced['youPay']:,.0f}, "
        f"Fastest ${fastest['youPay']:,.0f}); its highest monthly payment is "
        f"${recommended['peakMonthlyPayment']:,.0f}, versus a ${recommended['monthlyBudget']:,.0f} budget, "
        f"so it is {'within' if recommended['peakMonthlyPayment'] <= recommended['monthlyBudget'] else 'above'} budget. "
        f"It finishes in {recommended['completionMonth']}, {next_year_text}, leaves "
        f"${recommended['benefitRemaining']:,.0f} of current-year benefit, and costs "
        f"${abs(cost_difference):,.0f} {'more' if cost_difference > 0 else 'less' if cost_difference < 0 else 'the same as'} Fastest "
        f"and ${abs(budget_difference):,.0f} {'more' if budget_difference > 0 else 'less' if budget_difference < 0 else 'the same as'} Budget."
    )


def extract_with_fallback(text: str) -> list[dict]:
    return groq_extract(text) or extract_procedures(text)


def _field(text: str, label: str) -> str:
    line_match = re.search(
        rf"^\s*{re.escape(label)}\s*:?\s*(.+?)\s*$",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    if line_match:
        return line_match.group(1).strip()
    labels = (
        "Patient",
        "Employee ID",
        "Employer",
        "Dental Plan",
        "Email",
        "Visit Date",
        "Provider",
        "Report #",
    )
    next_labels = "|".join(re.escape(item) for item in labels if item != label)
    match = re.search(
        rf"\b{re.escape(label)}\s+(.+?)(?=\s{{2,}}(?:{next_labels})\s+|$)",
        text,
        re.MULTILINE,
    )
    return match.group(1).strip() if match else ""


def lookup_nppes(text: str, provider_name: str) -> dict:
    match = NPI_RE.search(text)
    if not match:
        return {
            "name": provider_name,
            "npi": None,
            "location": None,
            "source": "treatment plan",
        }
    npi = match.group(1)
    request = urllib.request.Request(
        "https://npiregistry.cms.hhs.gov/api/?"
        + urllib.parse.urlencode({"number": npi, "version": "2.1"}),
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        result = payload.get("results", [])[0]
        basic = result.get("basic", {})
        address = next(
            (
                item for item in result.get("addresses", [])
                if item.get("address_purpose") == "LOCATION"
            ),
            result.get("addresses", [{}])[0],
        )
        location = ", ".join(
            value for value in (
                address.get("address_1"),
                address.get("city"),
                address.get("state"),
                address.get("postal_code"),
            ) if value
        )
        return {
            "name": " ".join(
                value for value in (
                    basic.get("name_prefix"),
                    basic.get("first_name"),
                    basic.get("last_name"),
                ) if value
            ) or provider_name,
            "npi": npi,
            "location": location or None,
            "phone": address.get("telephone_number"),
            "source": "NPPES",
        }
    except (
        KeyError,
        IndexError,
        TypeError,
        ValueError,
        urllib.error.URLError,
        TimeoutError,
    ):
        return {
            "name": provider_name,
            "npi": npi,
            "location": None,
            "source": "treatment plan",
        }


def _money(value: float) -> int:
    return int(round(value))


def load_employee(email: str | None) -> dict:
    database = sqlite3.connect(":memory:")
    try:
        for filename in ("plans.sql", "employees.sql", "benefit_usage.sql"):
            database.executescript(
                (MOCK_DATABASE_DIR / filename).read_text(encoding="utf-8")
            )
        selected_email = email or "alex.carter@usm-demo.com"
        row = database.execute(
            """
            SELECT e.first_name || ' ' || e.last_name, e.email,
                   e.plan_id, e.enrolled_plan, p.provider, p.plan_name,
                   p.plan_type, p.annual_maximum, p.deductible,
                   p.preventive_coverage, p.basic_coverage,
                   p.major_coverage, p.orthodontic_coverage,
                   p.in_network_supported, p.out_of_network_supported,
                   b.annual_benefit_used, b.deductible_used
            FROM employees e
            JOIN plans p ON p.plan_id = e.plan_id
            JOIN benefit_usage b ON b.employee_id = e.employee_id
            WHERE lower(e.email) = lower(?)
            """,
            (selected_email,),
        ).fetchone()
        if not row:
            raise ValueError("No employee record found for this account.")
        keys = (
            "name",
            "email",
            "plan_id",
            "enrolled_plan",
            "provider",
            "plan_name",
            "plan_type",
            "annual_maximum",
            "deductible",
            "preventive_rate",
            "basic_rate",
            "major_rate",
            "orthodontic_rate",
            "in_network_supported",
            "out_of_network_supported",
            "benefit_used",
            "deductible_used",
        )
        employee = dict(zip(keys, row))
        employee["enrolled_plan"] = employee["plan_name"]
        employee["remaining_maximum"] = max(
            0,
            employee["annual_maximum"] - employee["benefit_used"]
        ) if employee["annual_maximum"] is not None else None
        employee["remaining_deductible"] = max(
            0, employee["deductible"] - employee["deductible_used"]
        )
        return employee
    finally:
        database.close()


def insurance_info(employee: dict) -> dict:
    plan = dental_plan(employee)
    remaining_annual_maximum = (
        max(0, plan["annualMaximum"] - employee["benefit_used"])
        if plan["annualMaximum"] is not None else None
    )
    return {
        "provider": employee["provider"], "planName": employee["plan_name"],
        "enrolledPlan": employee["enrolled_plan"],
        "planType": employee["plan_type"], "annualMaximum": plan["annualMaximum"],
        "remainingAnnualMaximum": remaining_annual_maximum,
        "annualBenefitUsed": employee["benefit_used"],
        "remainingDeductible": employee["remaining_deductible"],
        "coverage": {
            "preventive": plan.get("preventiveCoverage"),
            "basic": plan.get("basicCoverage"),
            "major": plan.get("majorCoverage"),
            "orthodontic": plan.get("orthodontiaCoverage"),
        },
        "coverageModel": plan["coverageModel"],
        "networkRule": plan["networkRule"],
        "inNetworkAllowed": plan["inNetworkAllowed"],
        "outOfNetworkAllowed": plan["outOfNetworkAllowed"],
    }


def benefits_response(email: str | None) -> dict:
    employee = load_employee(email)
    plan = dental_plan(employee)
    with sqlite3.connect(":memory:") as database:
        for filename in ("plans.sql", "employees.sql", "benefit_transactions.sql"):
            database.executescript((MOCK_DATABASE_DIR / filename).read_text())
        rows = database.execute(
            """SELECT CAST(strftime('%m', service_date) AS INTEGER), SUM(benefit_used)
               FROM benefit_transactions WHERE employee_id =
               (SELECT employee_id FROM employees WHERE lower(email) = lower(?))
               AND strftime('%Y', service_date) = '2026'
               GROUP BY strftime('%m', service_date)""", (employee["email"],)
        ).fetchall()
    history = dict(rows)
    return {
        "email": employee["email"], "name": employee["name"],
        "enrolled_plan": employee["enrolled_plan"], "year": 2026,
        "annualMax": plan["annualMaximum"], "used": employee["benefit_used"],
        "remaining": (
            max(0, plan["annualMaximum"] - employee["benefit_used"])
            if plan["annualMaximum"] is not None else None
        ), "insurance": insurance_info(employee),
        "months": [{"month": month, "amount": history.get(index, 0)}
                   for index, month in enumerate(
                       ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)],
    }


def project_response(payload: dict) -> dict:
    employee = load_employee(payload.get("employeeEmail"))
    plan = dental_plan(employee)
    procedures, schedule = payload.get("procedures"), payload.get("schedule")
    settings = normalize_settings(payload.get("settings"))
    if not isinstance(procedures, list) or not procedures or not isinstance(schedule, list):
        raise ValueError("Select a treatment plan before adding it.")
    if len(schedule) != len(procedures) or any(type(month) is not int for month in schedule):
        raise ValueError("Choose a month for every procedure.")
    if not any(candidate == schedule for candidate in generate_schedules(
        procedures, MONTHS.index(settings["latestMonth"])
    )):
        raise ValueError("This schedule does not meet the procedure constraints.")
    network = payload.get("network", "in")
    if network not in ("in", "out"):
        raise ValueError("Choose an available network scenario.")
    if network == "out" and not plan["outOfNetworkAllowed"]:
        logger.warning("Rejected out-of-network projection for plan=%s", plan["name"])
        raise ValueError(f"Out-of-network care is not available with {plan['name']}.")
    return {
        "email": employee["email"], "enrolled_plan": employee["enrolled_plan"],
        "year": 2026, "provider": payload.get("provider", "Your dental provider"),
        "procedures": procedures, "schedule": schedule, "network": network,
        "scenario": calculate_schedule(procedures, schedule, employee, network),
        "insurance": insurance_info(employee),
    }


MONTHS = ["Oct", "Nov", "Dec", "Jan"]

# Plan rows provide names, annual maximums, deductibles, coverage, and network
# support. These values control only behavior that is not represented in SQL.
PLAN_BEHAVIOR = {
    "PPO": {
        "coverageModel": "coinsurance",
        "networkRule": "PPO",
        "inNetworkAllowed": True,
        "outOfNetworkAllowed": True,
    },
    "INO": {
        "coverageModel": "coinsurance",
        "networkRule": "IN_NETWORK_ONLY",
        "inNetworkAllowed": True,
        "outOfNetworkAllowed": False,
    },
    "DHMO": {
        "coverageModel": "copay",
        "networkRule": "CLOSED_NETWORK",
        "inNetworkAllowed": True,
        "outOfNetworkAllowed": False,
        "copays": {"preventive": 0, "basic": 25, "major": 75, "orthodontic": 100},
    },
}


def dental_plan(employee: dict) -> dict:
    if not employee.get("enrolled_plan"):
        return {
            "name": "Legacy test plan",
            "coverageModel": "coinsurance",
            "annualMaximum": employee["annual_maximum"],
            "deductible": employee["deductible"],
            "preventiveCoverage": employee.get("preventive_rate", 100) / 100,
            "basicCoverage": employee.get("basic_rate", 80) / 100,
            "majorCoverage": employee.get("major_rate", 50) / 100,
            "orthodontiaCoverage": employee.get("orthodontic_rate", 50) / 100,
            "inNetworkAllowed": True,
            "outOfNetworkAllowed": True,
            "networkRule": "PPO",
        }
    plan_type = employee["plan_type"]
    behavior = PLAN_BEHAVIOR.get(plan_type)
    if behavior is None:
        raise ValueError(f"Unsupported dental plan type: {plan_type}.")
    plan = {
        "name": employee["plan_name"],
        "annualMaximum": employee["annual_maximum"],
        "deductible": employee["deductible"],
        "preventiveCoverage": employee["preventive_rate"] / 100,
        "basicCoverage": employee["basic_rate"] / 100,
        "majorCoverage": employee["major_rate"] / 100,
        "orthodontiaCoverage": employee["orthodontic_rate"] / 100,
        **behavior,
    }
    if plan_type != "DHMO":
        plan["inNetworkAllowed"] = bool(employee["in_network_supported"])
        plan["outOfNetworkAllowed"] = bool(employee["out_of_network_supported"])
    return plan


def normalize_settings(settings: dict | None) -> dict:
    result = {
        "budget": "$500", "priority": "Automatic",
        "provider": "In-network preferred", "latestMonth": "Jan",
    }
    if isinstance(settings, dict):
        result.update(settings)
    try:
        budget = float(str(result["budget"]).replace("$", "").replace(",", ""))
    except (ValueError, TypeError):
        raise ValueError("Provide a valid monthly budget.")
    if not math.isfinite(budget) or budget < 0:
        raise ValueError("Provide a valid monthly budget.")
    if result["latestMonth"] not in MONTHS:
        raise ValueError("Choose a completion month from Oct through Jan.")
    return result


def validate_provider_preference(settings: dict, employee: dict) -> None:
    if (
        settings["provider"] == "Any provider"
        and not dental_plan(employee)["outOfNetworkAllowed"]
    ):
        raise ValueError("Out-of-network care is not covered by your enrolled plan.")


def calculate_schedule(
    procedures: list[dict], schedule: list[int], employee: dict,
    network: str = "in",
) -> dict:
    plan = dental_plan(employee) if employee.get("enrolled_plan") else {
        "name": "Legacy test plan", "coverageModel": "coinsurance",
        "annualMaximum": employee["annual_maximum"], "deductible": employee["deductible"],
        "preventiveCoverage": employee.get("preventive_rate", 100) / 100,
        "basicCoverage": employee.get("basic_rate", 80) / 100,
        "majorCoverage": employee.get("major_rate", 50) / 100,
        "orthodontiaCoverage": employee.get("orthodontic_rate", 50) / 100,
        "inNetworkAllowed": True, "outOfNetworkAllowed": True,
    }
    annual_maximum = plan["annualMaximum"]
    logger.info(
        "Calculating dental schedule: plan=%s model=%s network=%s procedures=%d",
        plan["name"],
        plan["coverageModel"],
        network,
        len(procedures),
    )
    remaining = [
        float(employee["remaining_maximum"]) if annual_maximum is not None else None,
        float(annual_maximum) if annual_maximum is not None else None,
    ]
    deductibles = [float(employee["remaining_deductible"]), float(plan["deductible"])]
    paid = [0.0, 0.0]
    monthly = [0.0] * len(MONTHS)
    monthly_benefits = [0.0] * len(MONTHS)
    if network == "in" and not plan["inNetworkAllowed"]:
        logger.warning("Blocked network=%s for plan=%s", network, plan["name"])
        raise ValueError(f"Network is not available with {plan['name']}.")
    if network == "out" and not plan["outOfNetworkAllowed"]:
        logger.info("Out-of-network coverage disabled: plan=%s", plan["name"])
        factor = 0.0
    else:
        factor = 0.70 if network == "out" and not employee.get("enrolled_plan") else 1.0
    for procedure, month in sorted(zip(procedures, schedule), key=lambda item: item[1]):
        year = int(month >= 3)
        cost = float(procedure["cost"])
        category = procedure.get("category", "basic")
        if plan["coverageModel"] == "copay":
            copay = min(float(plan["copays"].get(category, 25)), cost)
            covered = cost - copay
            paid[year] += covered
            monthly[month] += copay
            monthly_benefits[month] += covered
            continue
        rate = plan[{
            "preventive": "preventiveCoverage",
            "basic": "basicCoverage",
            "major": "majorCoverage",
            "orthodontic": "orthodontiaCoverage",
        }.get(category, "basicCoverage")]
        deductible = 0.0
        if category != "preventive" and rate * factor > 0:
            deductible = min(deductibles[year], cost)
            deductibles[year] -= deductible
        covered = (cost - deductible) * rate * factor
        if remaining[year] is not None:
            covered = min(remaining[year], covered)
            remaining[year] -= covered
        paid[year] += covered
        monthly[month] += cost - covered
        monthly_benefits[month] += covered
    total = sum(float(p["cost"]) for p in procedures)
    result = {
        "totalCost": round(total, 2), "planPays": round(sum(paid), 2),
        "youPay": round(total - sum(paid), 2),
        "benefitUsed": round(paid[0], 2),
        "benefitRemaining": round(remaining[0], 2) if remaining[0] is not None else None,
        "nextYearUsed": round(paid[1], 2), "months": MONTHS, "network": network,
        "monthlyPayments": [round(value, 2) for value in monthly],
        "monthlyBenefitPayments": [round(value, 2) for value in monthly_benefits],
        "peakMonthlyPayment": round(max(monthly), 2),
    }
    logger.info(
        "Dental schedule result: plan=%s network=%s planPays=%.2f patientPays=%.2f benefitUsed=%.2f remaining=%s",
        plan["name"],
        network,
        result["planPays"],
        result["youPay"],
        result["benefitUsed"],
        result["benefitRemaining"],
    )
    return result


def generate_schedules(procedures: list[dict], latest: int = 3):
    # dependsOn contains zero-based procedure indexes that must occur in an earlier month.
    for index, procedure in enumerate(procedures):
        cost = procedure.get("cost")
        if not isinstance(cost, (float, int)) or not math.isfinite(cost) or cost < 0:
            raise ValueError("Each procedure needs a nonnegative cost.")
        dependencies = procedure.get("dependsOn", [])
        if not isinstance(dependencies, list) or any(
            type(dep) is not int or dep < 0 or dep >= len(procedures) or dep == index
            for dep in dependencies
        ):
            raise ValueError("Invalid procedure dependencies.")
    choices = [(0,) if p.get("canDelay") is False else range(latest + 1) for p in procedures]
    for schedule in itertools.product(*choices):
        if all(schedule[dep] < schedule[i] for i, p in enumerate(procedures)
               for dep in p.get("dependsOn", [])):
            yield list(schedule)


def find_best_options(procedures: list[dict], employee: dict, settings: dict | None = None
                      ) -> dict[str, tuple[list[int], dict]]:
    if not procedures:
        raise ValueError("At least one procedure is required.")
    settings = normalize_settings(settings)
    budget = float(str(settings["budget"]).replace("$", "").replace(",", ""))
    winners = {}
    keys = {}
    for schedule in generate_schedules(procedures, MONTHS.index(settings["latestMonth"])):
        scenario = calculate_schedule(procedures, schedule, employee)
        cost, peak = scenario["youPay"], scenario["peakMonthlyPayment"]
        finish, delay = max(schedule), sum(schedule)
        objectives = {
            "budget": (cost, -finish, -delay),
            "balanced": (peak > budget, peak, cost, finish, delay),
            "premium": (finish, delay, cost),
        }
        for name, key in objectives.items():
            if name not in keys or key < keys[name]:
                keys[name] = key
                winners[name] = (schedule, scenario)
    if not winners:
        raise ValueError("No schedule meets the procedure constraints and completion month.")
    return winners


# Product heuristics, not insurance rules. Keep these thresholds explicit.
NEARLY_EXHAUSTED_FRACTION = 0.20
MIN_MEANINGFUL_SAVINGS = 100.0
MEANINGFUL_SAVINGS_FRACTION = 0.05
MAX_BALANCED_EXTRA_COST = 100.0
MAX_BALANCED_EXTRA_FRACTION = 0.10


def recommend_option(selected: dict, employee: dict, settings: dict) -> tuple[str, str]:
    explicit = {"Lowest cost": "budget", "Budget": "budget", "Balanced": "balanced",
                "Fastest": "premium"}.get(settings.get("priority"))
    if explicit:
        return explicit, f"Recommended because you selected {settings['priority']} as your priority."
    budget_schedule, cheapest = selected["budget"]
    _, balanced = selected["balanced"]
    fastest_schedule, fastest = selected["premium"]
    monthly_budget = float(str(settings["budget"]).replace("$", "").replace(",", ""))
    savings = round(fastest["youPay"] - cheapest["youPay"], 2)
    meaningful = savings >= max(MIN_MEANINGFUL_SAVINGS,
                               fastest["youPay"] * MEANINGFUL_SAVINGS_FRACTION)
    plan = dental_plan(employee)
    nearly_exhausted = (
        plan["annualMaximum"] is not None
        and employee["remaining_maximum"] <= plan["annualMaximum"] * NEARLY_EXHAUSTED_FRACTION
    )
    moved_to_next_year = any(month == 3 and fastest_schedule[i] < 3
                             for i, month in enumerate(budget_schedule))
    if nearly_exhausted and moved_to_next_year and meaningful:
        return "budget", f"Recommended because current-year benefits are nearly exhausted and deferring flexible care saves ${savings:,.2f} versus Fastest."
    affordable = balanced["peakMonthlyPayment"] <= monthly_budget
    small_extra = balanced["youPay"] - cheapest["youPay"] <= max(
        MAX_BALANCED_EXTRA_COST, cheapest["youPay"] * MAX_BALANCED_EXTRA_FRACTION)
    # Prefer affordability when Fastest exceeds the budget; otherwise a tie favors speed.
    if affordable and small_extra and (meaningful or fastest["peakMonthlyPayment"] > monthly_budget):
        return "balanced", "Recommended because it fits your monthly budget without major added cost versus Budget."
    if not meaningful:
        return "premium", f"Recommended because delaying would save only ${savings:,.2f} versus Fastest."
    return "budget", "Recommended because it offers meaningful savings and Balanced cannot meet the affordability and added-cost criteria."


def option_reasoning(name: str, procedures: list[dict], schedule: list[int],
                     scenario: dict, employee: dict, settings: dict, completion: str,
                     description: str, fastest: tuple[list[int], dict]) -> str:
    money = lambda amount: "not applicable" if amount is None else f"${amount:,.2f}"
    plan = dental_plan(employee)
    configured_deductible = (
        plan["deductible"] if employee.get("enrolled_plan") else employee["deductible"]
    )
    current_remaining = (
        employee["remaining_maximum"] if plan["annualMaximum"] is not None else None
    )
    budget = float(str(settings["budget"]).replace("$", "").replace(",", ""))
    fastest_schedule, fastest_scenario = fastest
    savings = round(fastest_scenario["youPay"] - scenario["youPay"], 2)
    comparison = (f"Saves {money(savings)} compared with Fastest." if savings > 0 else
                  f"Costs {money(-savings)} more than Fastest." if savings < 0 else
                  "Savings compared with Fastest: $0.00.")
    objectives = {
        "budget": "Selected for the lowest total patient cost, then the latest feasible completion and latest overall schedule among cost ties.",
        "balanced": "Selected to stay within the monthly budget first, then minimize peak monthly payment and total patient cost, with earlier completion breaking ties.",
        "premium": "Selected for the earliest completion, then the least total delay; cost only breaks ties.",
    }
    movements = [
        f"{procedure.get('name', f'Procedure {i + 1}')} from {MONTHS[fastest_schedule[i]]} to {MONTHS[month]}"
        for i, (procedure, month) in enumerate(zip(procedures, schedule))
        if month != fastest_schedule[i]
    ]
    movement = ("Schedule changes versus Fastest: " + "; ".join(movements) + ". "
                if movements else "No procedures moved compared with Fastest. ")
    movement += objectives[name]
    peak_change = round(scenario["peakMonthlyPayment"] - fastest_scenario["peakMonthlyPayment"], 2)
    impact = (f"Peak monthly payment is {money(abs(peak_change))} "
              f"{'lower' if peak_change < 0 else 'higher'} than Fastest."
              if peak_change else "Peak monthly payment is unchanged from Fastest.")
    deductible = (f"Your current-year deductible is met."
                  if employee["remaining_deductible"] == 0
                  else f"You have {money(employee['remaining_deductible'])} left on your current-year deductible.")
    affordability = "within" if scenario["peakMonthlyPayment"] <= budget else "above"
    next_year_count = sum(month == 3 for month in schedule)
    rollover = (
        f"{next_year_count} procedure(s) are scheduled in the next benefit year, with "
        f"{money(scenario['nextYearUsed'])} in estimated next-year coverage. "
        f"This assumes the same plan renews with a {money(plan['annualMaximum'])} annual allowance "
        f"and a {money(configured_deductible)} deductible."
        if next_year_count else "No procedures move into the next benefit year."
    )
    return (
        f"{movement} {comparison} {description} You start with {money(current_remaining)} of current-year benefits "
        f"remaining; this schedule uses {money(scenario['benefitUsed'])} and leaves "
        f"{money(scenario['benefitRemaining'])}. {deductible} "
        f"Your largest estimated monthly payment is {money(scenario['peakMonthlyPayment'])}, "
        f"{affordability} your {money(budget)} monthly budget. "
        f"{impact} Treatment finishes in {completion}. {rollover}"
    )


def build_options(procedures: list[dict], employee: dict, settings: dict) -> list[dict]:
    settings = normalize_settings(settings)
    validate_provider_preference(settings, employee)
    selected = find_best_options(procedures, employee, settings)
    recommended, recommendation_reason = recommend_option(selected, employee, settings)
    budget = float(str(settings["budget"]).replace("$", "").replace(",", ""))
    descriptions = {
        "budget": "Lowest cost strategy.",
        "balanced": "Prioritize monthly affordability, then total patient cost.",
        "premium": "Finish treatment as soon as the procedure constraints allow.",
    }
    options = []
    for name, (schedule, scenario) in selected.items():
        start, finish = min(schedule), max(schedule)
        label = lambda month: f"{MONTHS[month]} {2027 if month == 3 else 2026}"
        description = descriptions[name]
        if name == "balanced" and scenario["peakMonthlyPayment"] > budget:
            description = "No schedule fits your monthly budget; this minimizes your largest monthly payment."
        same = ["Fastest" if other == "premium" else other.title()
                for other, (other_schedule, _) in selected.items()
                if other != name and schedule == other_schedule]
        if same and name == "balanced" and scenario["peakMonthlyPayment"] <= budget:
            description = "Same schedule also satisfies your monthly budget."
        elif same and name == "premium":
            description = "Same schedule is also the earliest feasible option."
        reasoning = option_reasoning(name, procedures, schedule, scenario, employee, settings,
                                     label(finish), description, selected["premium"])
        if name == recommended:
            reasoning += " " + recommendation_reason
        options.append({
            "reasoning": reasoning,
            "id": name, "name": "Fastest" if name == "premium" else name.title(),
            "description": description, "recommended": name == recommended,
            "youPay": scenario["youPay"], "planPays": scenario["planPays"],
            "benefitRemaining": scenario["benefitRemaining"],
            "range": label(start) if start == finish else f"{label(start)} – {label(finish)}",
            "completionMonth": label(finish), "peakMonthlyPayment": scenario["peakMonthlyPayment"],
            "monthlyBudget": budget,
            "sameScheduleAs": same, "schedule": schedule,
            "scenario": {"in": scenario, "out": calculate_schedule(procedures, schedule, employee, "out")},
        })
    return options


def build_response(text: str, email: str | None = None) -> dict:
    procedures = extract_with_fallback(text)
    if not procedures:
        raise ValueError(
            "No procedures with costs were found. Include a procedure name and price."
        )

    employee = load_employee(email)
    provider = _field(text, "Provider") or "Your dental provider"
    provider_details = lookup_nppes(text, provider)
    visit_date = _field(text, "Visit Date") or date.today().strftime("%b %-d, %Y")
    months = ["Oct", "Nov", "Dec", "Jan"]
    settings = normalize_settings(None)
    options = build_options(procedures, employee, settings)
    options, explanation = add_ai_recommendation(options)

    return {
        "provider": provider,
        "providerDetails": provider_details,
        "date": visit_date,
        "dentist": provider,
        "months": months,
        "procedures": procedures,
        "pricing": {
            "source": "treatment estimate",
            "totalEstimatedCost": _money(sum(item["cost"] for item in procedures)),
            "procedures": [
                {
                    "name": item["name"],
                    "estimatedCost": item["cost"],
                    "code": item["code"],
                }
                for item in procedures
            ],
        },
        "insurance": insurance_info(employee),
        "enrolled_plan": employee["enrolled_plan"],
        "settings": settings,
        "options": options,
        "explanation": explanation,
    }


def build_extraction(text: str) -> dict:
    """Return only the document text and normalized treatment data."""
    procedures = extract_with_fallback(text)
    if not procedures:
        raise ValueError(
            "No procedures with costs were found. Include a procedure name and price."
        )
    return {
        "text": text,
        "treatment": {
            "provider": _field(text, "Provider") or None,
            "visitDate": _field(text, "Visit Date") or None,
            "procedures": procedures,
        },
    }


def pdf_to_text(content: bytes) -> str:
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("That file is over 10 MB. Please upload a smaller PDF.")
    result = subprocess.run(
        ["pdftotext", "-layout", "-", "-"],
        input=content,
        capture_output=True,
        check=False,
        timeout=15,
    )
    if result.returncode != 0:
        raise ValueError("The PDF could not be read. Please upload a text-based PDF.")
    return result.stdout.decode("utf-8", errors="replace")


def authenticate(email: str, password: str) -> str | None:
    for employee_id, employee_email, employee_password in EMPLOYEE_RE.findall(
        EMPLOYEES_SQL.read_text(encoding="utf-8")
    ):
        if employee_email.casefold() == email.casefold() and hmac.compare_digest(
            employee_password, password
        ):
            return employee_id
    return None


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        endpoint = urlparse(self.path).path
        if endpoint not in {
            "/api/analyze",
            "/api/extract",
            "/api/optimize",
            "/api/project",
            "/api/login",
        }:
            self._json(404, {"error": "Not found"})
            return
        try:
            if endpoint == "/api/login":
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                email = str(payload.get("email", "")).strip()
                password = str(payload.get("password", ""))
                employee_id = authenticate(email, password)
                if not employee_id:
                    self._json(401, {"error": "Incorrect email or password."})
                    return
                self._json(200, {"employee_id": employee_id, "email": email,
                                 "name": load_employee(email)["name"]})
                return
            if endpoint in {"/api/optimize", "/api/project"}:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                payload["employeeEmail"] = (
                    payload.get("employeeEmail")
                    or self.headers.get("X-Employee-Email")
                )
                self._json(200, project_response(payload) if endpoint == "/api/project" else optimize_response(payload))
                return
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={"REQUEST_METHOD": "POST"},
            )
            text = form.getfirst("text", "") or ""
            if "file" in form and getattr(form["file"], "file", None):
                text = pdf_to_text(form["file"].file.read())
            if not text.strip():
                raise ValueError("Provide a PDF or treatment text to analyze.")
            email = form.getfirst("employeeEmail", "") or None
            self._json(
                200,
                build_extraction(text)
                if endpoint == "/api/extract"
                else build_response(text, email),
            )
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            self._json(422, {"error": str(error)})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/benefits":
            try:
                query = urllib.parse.parse_qs(urlparse(self.path).query)
                self._json(200, benefits_response(query.get("employeeEmail", [None])[0]))
            except ValueError as error:
                self._json(422, {"error": str(error)})
            return
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/frontend/index.html")
            self.end_headers()
            return
        elif path.startswith("/frontend/"):
            target = FRONTEND / path.removeprefix("/frontend/")
        elif path.startswith("/mock_lincoln_insurance_database/"):
            target = ROOT / path.lstrip("/")
        else:
            self.send_error(404)
            return
        target = target.resolve()
        allowed_root = (
            FRONTEND
            if path.startswith("/frontend/") or path == "/"
            else MOCK_DATABASE_DIR
        )
        if (
            not target.is_file()
            or allowed_root.resolve() not in target.parents
        ):
            self.send_error(404)
            return
        content_type = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".sql": "text/plain",
        }.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the BenefitPilot extraction server.")
    parser.add_argument(
        "--host",
        default=os.environ.get("HOST", "localhost"),
        help="interface to bind (default: HOST or localhost)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8001")),
        help="port to use (default: PORT or 8001)",
    )
    args = parser.parse_args()
    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            raise SystemExit(
                f"Port {args.port} is already in use. "
                f"If BenefitPilot is already running, open "
                f"http://{args.host}:{args.port}/frontend/index.html. "
                f"Otherwise stop the process using the port and try again."
            )
        raise
    actual_port = httpd.server_address[1]
    print(
        f"BenefitPilot running at http://{args.host}:{actual_port}/frontend/index.html",
        flush=True,
    )
    httpd.serve_forever()
