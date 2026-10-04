"""Local BenefitPilot server with PDF/text treatment extraction."""

from __future__ import annotations

import cgi
import argparse
import errno
import hmac
import json
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
    schedule = payload.get("schedule")
    if not isinstance(schedule, list) or len(schedule) != len(procedures):
        raise ValueError("A month must be selected for every procedure.")
    schedule = [max(0, min(3, int(month))) for month in schedule]
    employee = load_employee(payload.get("employeeEmail"))
    selected_id = str(payload.get("optionId", "balanced"))
    options = []
    for option in ("budget", "balanced", "premium"):
        in_scenario = calculate_schedule(procedures, schedule, employee, "in")
        out_scenario = calculate_schedule(procedures, schedule, employee, "out")
        options.append(
            {
                "id": option,
                "name": option.title(),
                "description": {
                    "budget": "Maximize your benefits and minimize your out-of-pocket costs.",
                    "balanced": "Balance your costs and use benefits efficiently.",
                    "premium": "Get treatment sooner with minimal out-of-pocket costs.",
                }[option],
                "recommended": option == selected_id,
                "youPay": in_scenario["youPay"],
                "planPays": in_scenario["planPays"],
                "benefitRemaining": in_scenario["benefitRemaining"],
                "range": "Oct 2026 – Jan 2027",
                "schedule": schedule,
                "scenario": {"in": in_scenario, "out": out_scenario},
            }
        )
    settings = payload.get("settings")
    return {
        "provider": payload.get("provider", "Your dental provider"),
        "providerDetails": payload.get("providerDetails"),
        "date": payload.get("date", date.today().strftime("%b %-d, %Y")),
        "dentist": payload.get("dentist", "Your dental provider"),
        "months": ["Oct", "Nov", "Dec", "Jan"],
        "procedures": procedures,
        "pricing": payload.get("pricing"),
        "insurance": payload.get("insurance"),
        "settings": settings if isinstance(settings, dict) else {},
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


def calculate_schedule(
    procedures: list[dict],
    schedule: list[int],
    employee: dict,
    network: str = "in",
) -> dict:
    months = ["Oct", "Nov", "Dec", "Jan"]
    rates = {
        "preventive": employee["preventive_rate"] / 100,
        "basic": employee["basic_rate"] / 100,
        "major": employee["major_rate"] / 100,
        "orthodontic": employee["orthodontic_rate"] / 100,
    }
    current_remaining = float(employee["remaining_maximum"])
    deductible_remaining = float(employee["remaining_deductible"])
    plan_pays = 0.0
    next_year_used = 0.0
    network_factor = 1.0 if network == "in" else 0.7
    if network == "out" and not employee["out_of_network_supported"]:
        network_factor = 0.0
    for procedure, month_index in sorted(
        zip(procedures, schedule), key=lambda item: item[1]
    ):
        rate = rates.get(procedure["category"], rates["basic"])
        eligible = procedure["cost"] * rate
        if procedure["category"] != "preventive":
            deductible_applied = min(deductible_remaining, procedure["cost"])
            deductible_remaining -= deductible_applied
            eligible = max(
                0, (procedure["cost"] - deductible_applied) * rate
            )
        if month_index >= 3:
            next_year_used += eligible * network_factor
        else:
            covered = min(current_remaining, eligible)
            current_remaining -= covered
            plan_pays += covered
    if network == "out":
        plan_pays *= network_factor
    total = sum(procedure["cost"] for procedure in procedures)
    return {
        "totalCost": _money(total),
        "planPays": _money(plan_pays),
        "youPay": _money(total - plan_pays),
        "benefitUsed": _money(plan_pays),
        "benefitRemaining": _money(current_remaining),
        "nextYearUsed": _money(next_year_used),
        "months": months,
        "network": network,
    }


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
    budget_schedule = [0] * len(procedures)
    for month_index, procedure_index in enumerate(
        sorted(range(len(procedures)), key=lambda i: procedures[i]["cost"], reverse=True)
    ):
        budget_schedule[procedure_index] = min(month_index, len(months) - 1)
    schedules = {
        "budget": budget_schedule,
        "balanced": [min(index, len(months) - 1) for index in range(len(procedures))],
        "premium": [0] * len(procedures),
    }
    options = []
    for option_id, description in (
        (
            "budget",
            "Maximize your benefits and minimize your out-of-pocket costs.",
        ),
        ("balanced", "Balance your costs and use benefits efficiently."),
        ("premium", "Get treatment sooner with minimal out-of-pocket costs."),
    ):
        schedule = schedules[option_id]
        scenario = calculate_schedule(procedures, schedule, employee, "in")
        out_scenario = calculate_schedule(procedures, schedule, employee, "out")
        options.append(
            {
                "id": option_id,
                "name": option_id.title(),
                "description": description,
                "recommended": option_id == "budget",
                "youPay": scenario["youPay"],
                "planPays": scenario["planPays"],
                "benefitRemaining": scenario["benefitRemaining"],
                "range": "Oct 2026 – Jan 2027",
                "schedule": schedule,
                "scenario": {"in": scenario, "out": out_scenario},
                "score": scenario["youPay"] + sum(schedule) * 10,
            }
        )

    recommended_id = min(options, key=lambda option: option["score"])["id"]
    for option in options:
        option["recommended"] = option["id"] == recommended_id
        option.pop("score")

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
        "settings": {
            "budget": "$500",
            "priority": "Lowest cost",
            "provider": "In-network preferred",
            "latestMonth": "Jan",
        },
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
