# codelinc

BenefitPilot frontend prototype, built with HTML, CSS, and JavaScript.

Run from the repository root:

```bash
python3 backend/server.py
```

Open `http://localhost:8001/` or
`http://localhost:8001/frontend/index.html`. The root URL redirects to the
frontend page. The server uses this fixed
port so the browser URL does not change between restarts. To choose a
different fixed port, run `python3 backend/server.py --port 8010`.

For deployment, serve the frontend and API from the same web origin so the
normal relative API URLs work without CORS configuration. The development
fallback for opening `frontend/index.html` directly with `file://` points to
`localhost:8001` and should not be used in production. To expose the Python
server on a network interface, run:

```bash
python3 backend/server.py --host 0.0.0.0 --port 8001
```

The server also reads `HOST` and `PORT` environment variables, and includes a
`Procfile` and `render.yaml` for deployment. In production, the platform-
provided `PORT` is used automatically:

```bash
HOST=0.0.0.0 PORT=8001 python3 backend/server.py
```

Frontend files live in `frontend/`. See [structure.md](structure.md) for the layout.
Dashboard, Alerts, and Treatments use the same employee benefit data from the
Python backend. `/api/benefits` reads annual totals from `benefit_usage.sql` and
monthly actuals from `benefit_transactions.sql`; the browser no longer needs
SQLite WebAssembly. The prototype planning year is 2026, with January 2027 kept
separate as next-year usage.

On Treatments, **Add plan** validates and prices the selected schedule through
`/api/project`, then saves it per employee in localStorage. The accepted plan
supplies dashboard projections and upcoming care. Adding again replaces the
accepted projection rather than duplicating it. Actual usage and remaining
benefits do not change until claims are recorded; projected usage and remaining
after the plan are displayed separately. Seed upcoming-care estimates are no
longer included in projections. Changes sync across tabs and survive reloads.

The local server exposes `/api/extract` for the current extraction step. It
extracts text from uploaded, text-based PDFs with `pdftotext`, then returns
structured JSON containing the source text, provider/date metadata, and
procedures with CDT codes, categories, and costs. Pasted text with one
procedure and cost per line is supported as well. `/api/analyze` wraps the
same extraction and adds the existing demo optimization response consumed by
the Treatments page.
Login uses the local `/api/login` endpoint and no longer depends on loading
SQLite or an external CDN in the browser.
If `GROQ_API_KEY` is configured, extraction uses the Groq model in
`GROQ_MODEL` (default `openai/gpt-oss-20b`) and falls back to the local
parser if Groq is unavailable. Keep `.env` local and add both variables to
Render under **Environment**; never commit the key.

The treatment pipeline separates responsibilities:

```text
NPPES -> provider identity and location (when an NPI is present)
treatment estimate -> procedure pricing and total estimated cost
insurance seed data -> plan coverage, deductible, and annual maximum
optimizer -> network scenarios and treatment scheduling
```

The backend returns `providerDetails`, `pricing`, and `insurance` alongside
the care options. NPPES is queried only when the treatment text contains a
10-digit NPI; if it is unavailable, the treatment-plan provider text remains
the source of truth.

Optimization is deterministic: the backend calculates Budget, Balanced, and
Fastest schedules and their benefit scenarios first. When `GROQ_API_KEY` is
configured, Groq receives only those computed results and writes the
user-facing explanations; it never selects schedules or changes financial
values. If Groq is unavailable, the deterministic explanations are returned.

The optimizer evaluates feasible assignments across October 2026–January 2027:

- **Budget** minimizes total employee cost, then deliberately chooses the latest
  feasible completion among equal-cost schedules, then the latest overall schedule
  by maximizing total delay among the remaining ties.
- **Balanced** prioritizes staying within the monthly budget, then minimizes the
  largest monthly payment and total patient cost, then prefers earlier completion.
- **Fastest** minimizes completion time, then overall waiting; cost only breaks ties.

The latest acceptable month applies to every option. Non-delayable procedures
stay in October. Optional `dependsOn` arrays contain zero-based procedure
indexes that must occur in an earlier month; sequence is never inferred from
input order. Infeasible constraints return a validation error.

January starts a separate deductible and annual benefit allowance, assuming
renewal of the same plan. Total insurance payments include both years; annual
usage fields remain separate. Monthly payments estimate treatment costs in the
scheduled month, not a financing arrangement. All three options use the same
in-network pricing assumptions, with out-of-network comparisons available. The named
`OUT_OF_NETWORK_BENEFIT_FACTOR = 0.70` is a demo assumption, not a verified
insurer rate; the existing network calculation is unchanged.
Cards show plan names, costs, recommendation badges, and schedule ranges.
Explanations and monthly payment details remain available in the API response. Each option includes
`reasoning` covering remaining annual benefits, deductible status, monthly budget,
completion month, next-year procedures, schedule changes versus Fastest, actual
savings versus Fastest, and the change in peak monthly payment. A later Budget
schedule may have zero savings when selected by the latest-completion tie-breaker.
Explicit priority controls the
recommendation badge; the default **Automatic** uses these product heuristics:

- Recommend Budget when at most 20% of annual benefits remain and moving flexible
  procedures into January saves at least $100 and 5% versus Fastest.
- Recommend Balanced when it meets the monthly budget and costs no more than
  Budget plus the greater of $100 or 10%, provided delaying offers meaningful
  savings or Fastest exceeds the monthly budget.
- Otherwise recommend Fastest when savings from delaying are below the meaningful
  threshold; use Budget when meaningful savings remain but Balanced fails the criteria.

These thresholds select a recommendation; they never alter calculated costs. Existing API fields and option IDs are
preserved; monthly payment and shared-schedule metadata are additive.

Run optimizer checks with `python3 -m unittest discover -s tests -v`.

## Deploy to Render

This repository includes a Docker deployment configuration. Docker installs
`poppler-utils`, which provides the `pdftotext` command required for PDF
extraction.

1. Push the repository to GitHub.
2. In Render, choose **New +** → **Blueprint**.
3. Select the GitHub repository and the `main` branch.
4. Render detects `render.yaml` and creates the `benefitpilot` web service.
5. Wait for the deploy to finish, then open the generated `onrender.com` URL
   followed by `/frontend/index.html`.

The service start command is defined by the `Dockerfile`, and Render supplies
the production `PORT` environment variable automatically.

#nishan thapa

## Shared notifications

`frontend/notifications.js` supplies the same feed, unread count, and latest-unread
popup to Dashboard, Treatments, and Alerts. `frontend/benefits.js` supplies the
shared employee snapshot. Benefit alerts appear only when remaining benefits (including an accepted plan
projection) are strictly below 20% of the annual maximum; at 20% or above, the
dashboard banner is hidden and no low-benefit notification is generated.
Unrelated demo alerts and fixed benefit amounts are removed. Each alert has a stable
`id`, a boolean `read`, a `status` (`active`, `expired`, or `resolved`), and optionally
`createdAt` and `expiresAt` timestamps. Only expired/resolved alerts appear in Past
Alerts; reading an alert never archives or removes it.

Read IDs and cleared past-alert IDs are saved per employee email in localStorage.
Opening a card or popup link updates badges before navigation, and storage events
synchronize other tabs. The popup shows the five newest unread active alerts.
This is browser-local hackathon state, not server-side persistence.

Run notification checks with `node tests/test_notifications.cjs`.

Run shared benefit/projection checks with `node tests/test_benefits.cjs`.
