/* ================= CONFIG ================= */
const CONFIG = {
  API_URL: "/api/dashboard", // GET -> JSON (shape below)
  USE_MOCK_ON_ERROR: true, // set to false once your backend is live
};

/*
  Expected backend response (JSON):
  {
    user: { name },
    planYear: { start: "Jan 1, 2026", end: "Dec 31, 2026", year: 2026 },
    annualMax: 1500, used: 980, remaining: 520,
    chart: { axisMax: 600, step: 200,
             months: [{ month: "Jan", amount: 90, projected: false }, ... 12 items] },
    upcoming: [{ date: "Oct 15, 2026", procedure: "Filling #1", provider: "Downtown Dental", href: "results.html" }]
  }
*/
const MOCK = {
  user: { name: "Bhargav Chataut" },
  planYear: { start: "Jan 1, 2026", end: "Dec 31, 2026", year: 2026 },
  annualMax: 1500,
  used: 980,
  remaining: 520,
  chart: {
    axisMax: 600,
    step: 200,
    months: [
      ["Jan", 90],
      ["Feb", 275],
      ["Mar", 175],
      ["Apr", 70],
      ["May", 180],
      ["Jun", 375],
      ["Jul", 250],
      ["Aug", 70],
      ["Sep", 310, 1],
      ["Oct", 450, 1],
      ["Nov", 235, 1],
      ["Dec", 120, 1],
    ].map(([month, amount, p]) => ({ month, amount, projected: !!p })),
  },
  upcoming: [
    {
      date: "Oct 15, 2026",
      procedure: "Filling #1",
      provider: "Downtown Dental",
      href: "results.html",
    },
    {
      date: "Nov 12, 2026",
      procedure: "Filling #2",
      provider: "Downtown Dental",
      href: "results.html",
    },
    {
      date: "Jan 10, 2027",
      procedure: "Crown",
      provider: "Downtown Dental",
      href: "results.html",
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
  if (d.user) $("userName").textContent = d.user.name;

  // Annual maximum card
  $("yearLabel").textContent = d.planYear.year;
  $("planYear").textContent =
    `Plan year: ${d.planYear.start} – ${d.planYear.end}`;
  $("max").textContent = money(d.annualMax);
  $("used").textContent = money(d.used);
  $("remaining").textContent = money(d.remaining);
  const pct = Math.round((d.used / d.annualMax) * 100);
  $("pct").textContent = pct + "%";
  const C = 2 * Math.PI * 88;
  requestAnimationFrame(
    () => ($("arc").style.strokeDasharray = `${(pct / 100) * C} ${C}`),
  );

  // Year-at-a-glance chart
  const { axisMax, step, months } = d.chart;
  const ticks = [];
  for (let v = 0; v <= axisMax; v += step) ticks.push(v);

  $("yaxis").innerHTML = ticks
    .map(
      (v) => `<span style="bottom:${(v / axisMax) * 100}%">${money(v)}</span>`,
    )
    .join("");
  $("plot").innerHTML =
    ticks
      .map(
        (v) =>
          `<div class="hline" style="bottom:${(v / axisMax) * 100}%"></div>`,
      )
      .join("") +
    months
      .map(
        (
          m,
        ) => `<div class="col"><div class="bar${m.projected ? " proj" : ""}" style="height:0"
        data-h="${Math.min(100, (m.amount / axisMax) * 100)}" title="${esc(m.month)}: ${money(m.amount)}${m.projected ? " (projected)" : ""}"></div></div>`,
      )
      .join("");
  $("xaxis").innerHTML = months
    .map((m) => `<span>${esc(m.month)}</span>`)
    .join("");
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document
        .querySelectorAll(".bar")
        .forEach((b) => (b.style.height = b.dataset.h + "%")),
    ),
  );

  // Upcoming care
  $("events").innerHTML = d.upcoming.length
    ? d.upcoming
        .map(
          (e) => `
    <li><a class="ev" href="${esc(e.href || "results.html")}">
      <i></i><span class="date">${esc(e.date)}</span>
      <span><strong>${esc(e.procedure)}</strong><small>${esc(e.provider)}</small></span>
      <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </a></li>`,
        )
        .join("")
    : '<li class="empty">No upcoming care scheduled yet.</li>';
}

load();
