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
const mailto = (email) =>
  `<a href="mailto:${encodeURIComponent(email)}">${esc(email)}</a>`;

/* ================= LOAD ================= */
async function load() {
  await Promise.all([window.BenefitNotifications.ready, window.BenefitData.ready]);
  render(window.BenefitNotifications.getData());
  $("main").classList.remove("loading");
}

/* ================= RENDER ================= */
function render(d) {
  $("updated").textContent = "Last updated: " + d.lastUpdated;

  // alert cards
  $("alerts").innerHTML = d.alerts.length
    ? d.alerts
        .map(
          (a) => `
    <a class="al ${esc(a.type)} ${a.read ? "is-read" : "is-unread"}" data-alert-id="${esc(a.id)}" href="${esc(window.BenefitNotifications.safeHref(a.href))}">
      <span class="al-ic">${svg(a.icon)}</span>
      <div><span class="alert-read-label">${a.read ? "Read" : "Unread"}</span><h3>${esc(a.title)}</h3><p>${esc(a.body).replace(/\n/g, "<br>")}${a.email ? ` Email sent to ${mailto(a.email)}.` : ""}</p>${a.email ? '<small class="alert-email-status">Email sent</small>' : ""}</div>
      ${a.pill ? `<span class="pill">${esc(a.pill)}</span>` : "<span></span>"}
      <svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </a>`,
        )
        .join("")
    : '<p class="empty card" style="padding:28px">You’re all caught up. No active alerts.</p>';

  // snapshot
  const s = d.snapshot;
  if (!s) {
    ["ringAmt", "sMax", "sUsed", "sRem"].forEach(id => $(id).textContent = "—");
    $("alerts").innerHTML = '<p class="empty card" style="padding:28px">Benefits are unavailable. Please refresh to load your alerts.</p>';
    return;
  }
  $("ringAmt").textContent = money(s.remaining);
  $("sMax").textContent = money(s.annualMax);
  const snapshot = window.BenefitData.projection();
  $("ringAmt").textContent = money(snapshot.hasPlan ? snapshot.remaining : s.remaining);
  $("ringLabel").textContent = snapshot.hasPlan ? "Projected remaining" : "remaining";
  $("sUsed").textContent = money(snapshot.used);
  $("sUsedLbl").textContent = `Used (${s.year})`;
  $("sProjected").textContent = money(snapshot.projected);
  $("projectedSnapshot").hidden = !snapshot.hasPlan;
  $("projectedArc").hidden = !snapshot.hasPlan;
  $("sRem").textContent = money(snapshot.hasPlan ? snapshot.remaining : s.remaining);
  $("sRemLbl").textContent = snapshot.hasPlan ? "Projected remaining" : "Remaining";
  const C = 2 * Math.PI * 88;
  requestAnimationFrame(
    () => {
      const usedLength = (snapshot.used / s.annualMax) * C;
      $("arc").style.strokeDasharray = `${usedLength} ${C}`;
      const projectedArc = $("projectedArc");
      projectedArc.style.strokeDasharray = snapshot.hasPlan
        ? `${(snapshot.projected / s.annualMax) * C} ${C}`
        : `0 ${C}`;
      projectedArc.style.strokeDashoffset = snapshot.hasPlan ? -usedLength : 0;
    },
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
  window.BenefitNotifications.clearPast();
  renderPast(window.BenefitNotifications.getData().past);
});

window.addEventListener("benefit-alerts-data", () => render(window.BenefitNotifications.getData()));
load();
