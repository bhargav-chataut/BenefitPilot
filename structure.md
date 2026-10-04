# BenefitPilot Structure

Simple frontend layout for the reference design: a left sidebar with Dashboard,
Treatments, and Alerts, and page content on the right.

```text
codelinc/
├── frontend/
│   ├── login.html              # Sign-in page, without sidebar
│   ├── dashboard.html          # Benefit usage and upcoming care (planned)
│   ├── treatments.html         # Treatment plan screen from the reference
│   ├── alerts.html             # Reminders (planned)
│   ├── css/
│   │   ├── shared.css          # Sidebar, page layout, cards, buttons (planned)
│   │   ├── login.css           # Login styles
│   │   └── treatments.css      # Treatment list, schedule, comparison table
│   └── js/
│       ├── login.js            # Login behavior (currently empty)
│       └── treatments.js       # Treatment and scheduling interactions
├── MOCKDATA_BASE/
│   ├── employees.sql
│   ├── plans.sql
│   └── benefit_usuage.sql
├── .gitignore
├── README.md
├── structure.md
├── PLAN.md                     # Local planning document (gitignored)
├── UserFlow.md                 # Local user flow (gitignored)
└── tech.md                     # Local technical plan (gitignored)
```

## Sidebar and Layout

Keep the sidebar markup directly in each main HTML page for now. Use
`css/shared.css` for its consistent appearance and highlight the current page's
navigation link. Login keeps its own layout.

## Treatment Page

Keep these sections together in `treatments.html`:

- **Header:** Treatment Plan title and description.
- **Your Treatments:** Procedure names, prices, remove controls, and Add another treatment.
- **Schedule:** One row per procedure with month selection controls.
- **Compare Your Plans:** Collapsible comparison table for Budget, Balanced, and Premium.
- **Recommendation:** Recommended badge and explanation below the table.

Use `css/treatments.css` for the screen's styling and `js/treatments.js` for
adding/removing treatments, selecting months, and updating the comparison.
On smaller screens, stack the treatment list and schedule and allow the table
to scroll horizontally.

Files marked **planned** do not exist yet. The existing treatments page still
needs changes to match the reference. This document describes the intended
organization; no UI changes are included in this update.
