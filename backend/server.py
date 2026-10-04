"""Local BenefitPilot server with PDF/text treatment extraction."""

from __future__ import annotations

import cgi
import argparse
import errno
import hmac
import json
import os
import re
import subprocess
import urllib.error
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
    prompt = """Extract dental procedures from the text below.
Return only valid JSON with this shape:
{"procedures":[{"name":"string","code":"D#### or N/A","category":"preventive|basic|major|orthodontic","cost":0}]}
Use the CDT code when present. Infer category from the procedure and code.
Use a numeric cost in dollars. Do not invent procedures or costs.

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
            name = str(procedure.get("name", "")).strip()
            if not name:
                continue
            code = str(procedure.get("code", "N/A")).upper()
            cost = float(procedure.get("cost", 0))
            if cost < 0:
                continue
            category = _category(code, name)
            normalized.append(
                {
                    "name": name,
                    "code": code if CODE_RE.fullmatch(code) else "N/A",
                    "category": category,
                    "cost": round(cost, 2),
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


def _money(value: float) -> int:
    return int(round(value))


def build_response(text: str) -> dict:
    procedures = extract_with_fallback(text)
    if not procedures:
        raise ValueError(
            "No procedures with costs were found. Include a procedure name and price."
        )

    total = sum(p["cost"] for p in procedures)
    provider = _field(text, "Provider") or "Your dental provider"
    visit_date = _field(text, "Visit Date") or date.today().strftime("%b %-d, %Y")
    dentist = provider
    if provider.lower().startswith("dr."):
        dentist = provider

    months = ["Oct", "Nov", "Dec", "Jan"]
    rates = {"preventive": 1.0, "basic": 0.8, "major": 0.5}
    plan_pays = sum(p["cost"] * rates[p["category"]] for p in procedures)
    plan_pays = min(plan_pays, 1500)
    options = []
    for option_id, multiplier, description in (
        (
            "budget",
            0.95,
            "Maximize your benefits and minimize your out-of-pocket costs.",
        ),
        ("balanced", 1.0, "Balance your costs and use benefits efficiently."),
        ("premium", 1.08, "Get treatment sooner with minimal out-of-pocket costs."),
    ):
        option_plan_pays = min(total, plan_pays * multiplier)
        you_pay = max(0, total - option_plan_pays)
        schedule = [min(index, len(months) - 1) for index in range(len(procedures))]
        scenario = {
            "totalCost": _money(total),
            "planPays": _money(option_plan_pays),
            "youPay": _money(you_pay),
            "benefitUsed": _money(option_plan_pays),
            "benefitRemaining": _money(max(0, 1500 - option_plan_pays)),
            "nextYearUsed": 0,
        }
        options.append(
            {
                "id": option_id,
                "name": option_id.title(),
                "description": description,
                "recommended": option_id == "budget",
                "youPay": _money(you_pay),
                "planPays": _money(option_plan_pays),
                "benefitRemaining": _money(max(0, 1500 - option_plan_pays)),
                "range": "Oct 2026 – Jan 2027",
                "schedule": schedule,
                "scenario": {"in": scenario, "out": scenario.copy()},
            }
        )

    return {
        "provider": provider,
        "date": visit_date,
        "dentist": dentist,
        "months": months,
        "procedures": procedures,
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
        if endpoint not in {"/api/analyze", "/api/extract", "/api/login"}:
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
            self._json(200, build_extraction(text) if endpoint == "/api/extract" else build_response(text))
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
