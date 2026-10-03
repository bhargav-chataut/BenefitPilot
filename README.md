# codelinc

BenefitPilot frontend prototype, built with HTML, CSS, and JavaScript.

Run from the repository root:

```bash
python3 -m http.server 8000 --directory frontend
```

Open http://localhost:8000/login.html or http://localhost:8000/treatments.html.

Frontend files live in `frontend/`. See [structure.md](structure.md) for the layout.
The login script is currently empty. Treatments use demo data when the backend
endpoints `/api/analyze` and `/api/optimize` are unavailable.

#nishan thapa
