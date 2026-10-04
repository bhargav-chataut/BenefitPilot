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
  const snapshot = window.BenefitData.projection();
  const remaining = snapshot.hasPlan ? snapshot.remaining : data.remaining;
  alert.hidden = !(data.annualMax > 0 && remaining / data.annualMax < 0.2);
  $("benefitAlertText").textContent =
    `${Math.round((remaining / data.annualMax) * 100)}% of your ${money(data.annualMax)} annual maximum will remain.`;
}
window.addEventListener('benefit-plan-changed', load);
window.addEventListener('pageshow', load);

/* ================= RENDER ================= */
function render(d) {
  if (d.user) {
    window.BenefitEmployee?.setName(d.user.name);
    const email = window.localStorage.getItem("benefitPilot.employeeEmail");
    if (email) window.localStorage.setItem("benefitPilot.employeeProfile", JSON.stringify({ email, name: d.user.name }));
  }

  // Annual maximum card
  $("yearLabel").textContent = d.planYear.year;
  $("annualPlanTitle").textContent = `Your annual plan: ${d.enrolled_plan}`;
  $("max").textContent = money(d.annualMax);
  $("used").textContent = money(d.used);
  const snapshot = window.BenefitData.projection();
  const usedAmount = snapshot.used + snapshot.projected;
  $("remaining").textContent = money(snapshot.hasPlan ? snapshot.remaining : d.remaining);
  $("projectedDonut").textContent = money(snapshot.projected);
  $("projectedStat").hidden = !snapshot.hasPlan;
  $("projectedArc").hidden = !snapshot.hasPlan;
  $("remainingLabel").textContent = snapshot.hasPlan ? "Projected remaining" : "Remaining";
  const pct = Math.round((usedAmount / d.annualMax) * 100);
  $("pct").textContent = snapshot.hasPlan ? money(snapshot.remaining) : pct + "%";
  $("donutLabel").textContent = snapshot.hasPlan ? "Projected remaining" : "used";
  const C = 2 * Math.PI * 88;
  requestAnimationFrame(
    () => {
      const usedLength = (snapshot.used / d.annualMax) * C;
      $("arc").style.strokeDasharray = `${usedLength} ${C}`;
      const projectedArc = $("projectedArc");
      projectedArc.style.strokeDasharray = snapshot.hasPlan
        ? `${(snapshot.projected / d.annualMax) * C} ${C}`
        : `0 ${C}`;
      projectedArc.style.strokeDashoffset = snapshot.hasPlan ? -usedLength : 0;
    },
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
    <li><div class="ev">
      <i></i><span class="date">${esc(e.date)}</span>
      <span><strong>${esc(e.procedure)}</strong><small>${esc(e.provider || e.status || "Scheduled")}</small></span>
    </div></li>`,
        )
        .join("")
    : '<li class="empty">No upcoming care scheduled yet.</li>';
}

load();
