# Simplest BenefitPilot Structure

One Next.js app. Proposed files:

```text
codelinc/
├── app/
│   ├── layout.tsx           # Shared layout
│   ├── globals.css          # All styles
│   ├── page.tsx             # Login
│   ├── dashboard/page.tsx   # Benefits and upcoming care
│   ├── treatments/page.tsx  # Input, schedule, compare, save
│   ├── alerts/page.tsx      # Reminders
│   └── actions.ts           # Server actions: auth, SQLite, AI, saving
├── calculator.ts            # Insurance math and care options
├── app.db                   # SQLite database (gitignored)
├── .env.local               # Secrets (gitignored)
└── package.json             # Dependencies and scripts
```

Keep each screen's UI in its page. Put database setup and mock data in `actions.ts` for the demo. Keep server actions authenticated and use `calculator.ts` for cost calculations.

Next.js/TypeScript configuration files and existing docs are omitted for clarity. Add folders only when needed.
