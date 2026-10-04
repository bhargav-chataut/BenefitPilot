/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function load() {
  await window.BenefitData.ready;
  const data = window.BenefitData.dashboard();
  $("main").classList.remove("loading");
  if (!data) {
    $("dashboardStatus").textContent = "We couldn’t load your benefits. Please refresh and try again.";
    return;
  }
  const axisMax = Math.max(100, Math.ceil(Math.max(...data.months.map(m => m.amount)) * 1.3 / 100) * 100);
  render({...data, user: {name: data.name},
    planYear: {start: `Jan 1, ${data.year}`, end: `Dec 31, ${data.year}`, year: data.year},
    chart: {axisMax, step: axisMax / 4, months: data.months},
  });
  $("projected").textContent = money(data.projected);
  $("projectedRemaining").textContent = money(data.projectedRemaining);
  $("nextYearProjected").textContent = money(data.nextYearProjected);
  const alert = $("benefitAlert");
  alert.hidden = !(data.annualMax > 0 && data.remaining / data.annualMax < 0.8);
  alert.textContent = `${money(data.remaining)} remaining — ${Math.round(data.remaining / data.annualMax * 100)}% of your annual benefits.`;
}
window.addEventListener('benefit-plan-changed', load);
window.addEventListener('pageshow', load);

/* ================= RENDER ================= */
function render(d) {
  if (d.user) {
    $("userName").textContent = d.user.name;
    const email = window.localStorage.getItem("benefitPilot.employeeEmail");
    if (email) window.localStorage.setItem("benefitPilot.employeeProfile", JSON.stringify({ email, name: d.user.name }));
  }

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
  $("xaxis").innerHTML = months.length
    ? months.map((m) => `<span>${esc(m.month)}</span>`).join("")
    : '<span class="chart-empty">No monthly transactions recorded yet.</span>';
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
