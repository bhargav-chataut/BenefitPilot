"""Local BenefitPilot server with PDF/text treatment extraction."""

from __future__ import annotations

import cgi
import argparse
import errno
import hmac
import itertools
import json
import math
import os
import re
import sqlite3
import subprocess
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
EMPLOYEES_SQL = ROOT / "MOCKDATA_BASE" / "employees.sql"
EMPLOYEE_RE = re.compile(
    r"\('([^']+)','[^']*','[^']*','([^']+)','([^']+)'",
)
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


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
    return {
        "provider": payload.get("provider", "Your dental provider"),
        "providerDetails": payload.get("providerDetails"),
        "date": payload.get("date", date.today().strftime("%b %-d, %Y")),
        "dentist": payload.get("dentist", "Your dental provider"),
        "months": ["Oct", "Nov", "Dec", "Jan"],
        "procedures": procedures,
        "pricing": payload.get("pricing"),
        "insurance": payload.get("insurance"),
        "settings": settings,
        "options": options,
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
                    "code": code_match.group(1).upper() if code_match else "N/A",
                    "category": _category(
                        code_match.group(1) if code_match else "", name
                    ),
                    "cost": round(float(money_match.group(1).replace(",", "")), 2),
                }
            )
    return procedures


def groq_extract(text: str) -> list[dict] | None:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None
    model = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
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
            code = str(procedure.get("code", "N/A")).upper()
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
                    "code": code if CODE_RE.fullmatch(code) else "N/A",
                    "category": category,
                    "cost": round(cost, 2),
                    "quantity": quantity,
                    "toothNumber": procedure.get("tooth_number"),
                    "urgency": procedure.get("urgency", "unknown"),
                    "canDelay": procedure.get("can_delay"),
                    "notes": procedure.get("notes", ""),
                }
            )
        return normalized or None
    except (
        KeyError,
        TypeError,
        ValueError,
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
    ):
        return None


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
                (ROOT / "MOCKDATA_BASE" / filename).read_text(encoding="utf-8")
            )
        selected_email = email or "alex.carter@usm-demo.com"
        row = database.execute(
            """
            SELECT e.first_name || ' ' || e.last_name, e.email,
                   p.provider, p.plan_name, p.plan_type,
                   p.annual_maximum, p.deductible,
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
        employee["remaining_maximum"] = max(
            0, employee["annual_maximum"] - employee["benefit_used"]
        )
        employee["remaining_deductible"] = max(
            0, employee["deductible"] - employee["deductible_used"]
        )
        return employee
    finally:
        database.close()


MONTHS = ["Oct", "Nov", "Dec", "Jan"]


def normalize_settings(settings: dict | None) -> dict:
    result = {
        "budget": "$500", "priority": "Balanced",
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


def calculate_schedule(
    procedures: list[dict], schedule: list[int], employee: dict,
    network: str = "in",
) -> dict:
    # The prototype assumes the same plan renews in January.
    remaining = [float(employee["remaining_maximum"]), float(employee["annual_maximum"])]
    deductibles = [float(employee["remaining_deductible"]), float(employee["deductible"])]
    paid = [0.0, 0.0]
    monthly = [0.0] * len(MONTHS)
    factor = 1.0 if network == "in" else 0.7
    if not employee.get(f"{network}_network_supported", True):
        factor = 0.0
    for procedure, month in sorted(zip(procedures, schedule), key=lambda item: item[1]):
        year = int(month >= 3)
        cost = float(procedure["cost"])
        category = procedure.get("category", "basic")
        rate = employee.get(category + "_rate", employee["basic_rate"]) / 100
        deductible = 0.0
        if category != "preventive" and rate * factor > 0:
            deductible = min(deductibles[year], cost)
            deductibles[year] -= deductible
        covered = min(remaining[year], (cost - deductible) * rate * factor)
        remaining[year] -= covered
        paid[year] += covered
        monthly[month] += cost - covered
    total = sum(float(p["cost"]) for p in procedures)
    return {
        "totalCost": round(total, 2), "planPays": round(sum(paid), 2),
        "youPay": round(total - sum(paid), 2),
        "benefitUsed": round(paid[0], 2), "benefitRemaining": round(remaining[0], 2),
        "nextYearUsed": round(paid[1], 2), "months": MONTHS, "network": network,
        "monthlyPayments": [round(value, 2) for value in monthly],
        "peakMonthlyPayment": round(max(monthly), 2),
    }


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
            "budget": (cost, finish, delay),
            "balanced": ((0, cost, finish, delay, peak) if peak <= budget
                         else (1, peak, cost, finish, delay)),
            "premium": (finish, delay, cost),
        }
        for name, key in objectives.items():
            if name not in keys or key < keys[name]:
                keys[name] = key
                winners[name] = (schedule, scenario)
    if not winners:
        raise ValueError("No schedule meets the procedure constraints and completion month.")
    return winners


def build_options(procedures: list[dict], employee: dict, settings: dict) -> list[dict]:
    selected = find_best_options(procedures, employee, settings)
    recommended = {"Lowest cost": "budget", "Balanced": "balanced", "Fastest": "premium"}.get(
        settings["priority"], "balanced")
    budget = float(str(settings["budget"]).replace("$", "").replace(",", ""))
    descriptions = {
        "budget": "Lowest total estimated cost; may use next year's benefits.",
        "balanced": "Lowest total estimated cost within your monthly budget.",
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
        options.append({
            "id": name, "name": "Fastest" if name == "premium" else name.title(),
            "description": description, "recommended": name == recommended,
            "youPay": scenario["youPay"], "planPays": scenario["planPays"],
            "benefitRemaining": scenario["benefitRemaining"],
            "range": label(start) if start == finish else f"{label(start)} – {label(finish)}",
            "completionMonth": label(finish), "peakMonthlyPayment": scenario["peakMonthlyPayment"],
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
        "insurance": {
            "provider": employee["provider"],
            "planName": employee["plan_name"],
            "planType": employee["plan_type"],
            "annualMaximum": employee["annual_maximum"],
            "remainingAnnualMaximum": employee["remaining_maximum"],
            "remainingDeductible": employee["remaining_deductible"],
            "coverage": {
                "preventive": employee["preventive_rate"],
                "basic": employee["basic_rate"],
                "major": employee["major_rate"],
                "orthodontic": employee["orthodontic_rate"],
            },
        },
        "settings": settings,
        "options": options,
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
                self._json(200, {"employee_id": employee_id, "email": email})
                return
            if endpoint == "/api/optimize":
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length))
                payload["employeeEmail"] = (
                    payload.get("employeeEmail")
                    or self.headers.get("X-Employee-Email")
                )
                self._json(200, optimize_response(payload))
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
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/frontend/index.html")
            self.end_headers()
            return
        elif path.startswith("/frontend/"):
            target = FRONTEND / path.removeprefix("/frontend/")
        elif path.startswith("/MOCKDATA_BASE/"):
            target = ROOT / path.lstrip("/")
        else:
            self.send_error(404)
            return
        target = target.resolve()
        allowed_root = FRONTEND if path.startswith("/frontend/") or path == "/" else ROOT / "MOCKDATA_BASE"
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
