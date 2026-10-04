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
The login and dashboard load the SQL seed files directly in the browser using
SQLite WebAssembly. The SQL files must be served over HTTP; opening the HTML
files directly from the filesystem will prevent the browser from loading them.
The dashboard reads annual totals from `benefit_usage.sql`, monthly history
from `benefit_transactions.sql`, and scheduled procedures from
`upcoming_care.sql`.
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
`GROQ_MODEL` (default `llama-3.1-8b-instant`) and falls back to the local
parser if Groq is unavailable. Keep `.env` local and add both variables to
Render under **Environment**; never commit the key.

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
