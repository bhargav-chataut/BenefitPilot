/* ================= CONFIG ================= */
const CONFIG = {
  API_URL: "/api/alerts", // GET -> JSON (shape below)
  CLEAR_URL: "/api/alerts/past", // DELETE -> clears past alerts (optional; failures are ignored)
  USE_MOCK_ON_ERROR: true, // set to false once your backend is live
};

/*
  Expected backend response (JSON):
  {
    lastUpdated: "Oct 1, 2026",
    alerts: [{
      id, type: "warning" | "info" | "danger" | "success",
      icon: "clock" | "calendar" | "warning" | "doc",
      title, body,                       // body may contain \n for a line break
      pill: "3 months left",             // optional button/label text
      href: "results.html"               // where the card links to
    }],
    snapshot: { annualMax, used, remaining, year },
    dates: [{ label, date, color: "red" | "blue" | "gray" }],
    past:  [{ icon: "mail" | "doc" | "info", title, body, date }]
  }
*/
const MOCK = {
  lastUpdated: "Oct 1, 2026",
  alerts: [
    {
      id: 1,
      type: "warning",
      icon: "clock",
      title: "You have $520 of your annual dental benefit remaining",
      body: "Your plan year ends January 1, 2027. Unused benefits typically do not roll over.",
      pill: "3 months left",
      href: "dashboard.html",
    },
    {
      id: 2,
      type: "info",
      icon: "calendar",
      title: "You have planned treatments that can be scheduled this year",
      body: "1 procedure is currently planned for next year. Moving it earlier may help you use more of your remaining benefits, if your dentist agrees.",
      pill: "Review Timing",
      href: "results.html",
    },
    {
      id: 3,
      type: "danger",
      icon: "warning",
      title: "Your current provider is out-of-network",
      body: "Your estimated out-of-pocket cost could be higher.\nConsider an in-network provider to maximize your benefits.",
      pill: "See In-Network Options",
      href: "results.html",
    },
    {
      id: 4,
      type: "success",
      icon: "doc",
      title: "New explanation of benefits (EOB) available",
      body: "Your recent claim from Sep 12, 2026 has been processed.",
      pill: "View EOB",
      href: "#",
    },
  ],
  snapshot: { annualMax: 1500, used: 980, remaining: 520, year: 2026 },
  dates: [
    { label: "Plan year ends", date: "Jan 1, 2027", color: "red" },
    { label: "Next benefit reset", date: "Jan 1, 2027", color: "blue" },
    { label: "Upcoming appointment", date: "Oct 15, 2026", color: "blue" },
    { label: "Planned crown (flexible)", date: "Jan 2027", color: "gray" },
  ],
  past: [
    {
      icon: "mail",
      title: "Monthly reminder",
      body: "You had $620 of benefits remaining.",
      date: "Sep 1, 2026",
    },
    {
      icon: "doc",
      title: "Treatment plan analyzed",
      body: "We extracted 3 procedures from your dentist's treatment plan.",
      date: "Aug 28, 2026",
    },
    {
      icon: "info",
      title: "Welcome to BenefitPilot",
      body: "Start by uploading your dentist's treatment plan.",
      date: "Aug 20, 2026",
    },
  ],
};

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const ICONS = {
  clock:
    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4.500l3 1.500M9.500 3h5"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15" rx="2.500"/><path d="M3.500 10h17M8 3v4M16 3v4M8 13.500h.01M12 13.500h.01M16 13.500h.01M8 17h.01M12 17h.01"/>',
  warning:
    '<path d="M12 3.500 2.800 19.500h18.400L12 3.500zM12 10v4.500M12 17.200h.01"/>',
  doc: '<path d="M14 3H7.500A1.500 1.500 0 0 0 6 4.500v15A1.500 1.500 0 0 0 7.500 21h9a1.500 1.500 0 0 0 1.500-1.500V7l-4-4zM14 3v4h4M9 13l2 2 4-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.500 7 8.500 6.500L20.500 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.800h.01"/>',
};
const svg = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;

/* ================= LOAD ================= */
async function load() {
  let data;
  try {
    const res = await fetch(CONFIG.API_URL);
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    data = await res.json();
  } catch (err) {
    if (!CONFIG.USE_MOCK_ON_ERROR) {
      console.error(err);
      return;
    }
    data = MOCK;
  }
  render(data);
  $("main").classList.remove("loading");
}

/* ================= RENDER ================= */
function render(d) {
  $("updated").textContent = "Last updated: " + d.lastUpdated;

  // nav badge
  $("navBadge").textContent = d.alerts.length;
  $("navBadge").hidden = !d.alerts.length;

  // alert cards
  $("alerts").innerHTML = d.alerts.length
    ? d.alerts
        .map(
          (a) => `
    <a class="al ${esc(a.type)}" href="${esc(a.href || "#")}">
      <span class="al-ic">${svg(a.icon)}</span>
      <div><h3>${esc(a.title)}</h3><p>${esc(a.body).replace(/\n/g, "<br>")}</p></div>
      ${a.pill ? `<span class="pill">${esc(a.pill)}</span>` : "<span></span>"}
      <svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </a>`,
        )
        .join("")
    : '<p class="empty card" style="padding:28px">You’re all caught up. No active alerts.</p>';

  // snapshot
  const s = d.snapshot;
  $("ringAmt").textContent = money(s.remaining);
  $("sMax").textContent = money(s.annualMax);
  $("sUsed").textContent = money(s.used);
  $("sUsedLbl").textContent = `Used (${s.year})`;
  $("sRem").textContent = money(s.remaining);
  const C = 2 * Math.PI * 88;
  requestAnimationFrame(
    () =>
      ($("arc").style.strokeDasharray =
        `${(s.remaining / s.annualMax) * C} ${C}`),
  );

  // important dates
  $("dates").innerHTML = d.dates
    .map(
      (x) =>
        `<li><i class="d ${esc(x.color)}"></i>${esc(x.label)}<b>${esc(x.date)}</b></li>`,
    )
    .join("");

  renderPast(d.past);
}

function renderPast(items) {
  $("clearAll").hidden = !items.length;
  $("past").innerHTML = items.length
    ? items
        .map(
          (p) => `
    <li>${svg(p.icon, "pi")}
      <div><strong>${esc(p.title)}</strong><small>${esc(p.body)}</small></div>
      <time>${esc(p.date)}</time></li>`,
        )
        .join("")
    : '<li class="empty">No past alerts.</li>';
}

/* ================= INTERACTIONS ================= */
$("clearAll").addEventListener("click", () => {
  renderPast([]);
  fetch(CONFIG.CLEAR_URL, { method: "DELETE" }).catch(() => {}); // ignore errors until backend exists
});

load();
