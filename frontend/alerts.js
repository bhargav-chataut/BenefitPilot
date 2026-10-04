/* ================= ALERTS SCRIPT ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");

function getSavedSession() {
  try {
    return JSON.parse(sessionStorage.getItem("benefitpilot_session") || "null");
  } catch {
    return null;
  }
}

/* ================= FILTER TABS ================= */
const filterButtons = document.querySelectorAll(".filter-btn");
const alertCards = document.querySelectorAll(".alert-item-card");

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const category = btn.dataset.filter;
    alertCards.forEach((card) => {
      if (category === "all" || card.dataset.category === category) {
        card.style.display = "flex";
      } else {
        card.style.display = "none";
      }
    });
  });
});

/* ================= USER MENU & SIGN OUT ================= */
const userMenuBtn = $("userMenuBtn");
const userDropdown = $("userDropdown");
if (userMenuBtn && userDropdown) {
  userMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle("show");
  });
  document.addEventListener("click", () => {
    userDropdown.classList.remove("show");
  });
}

const signOutBtn = $("signOutLink");
if (signOutBtn) {
  signOutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("benefitpilot_session");
  });
}

/* ================= DYNAMIC DATA HYDRATION ================= */
function initAlerts() {
  const session = getSavedSession();

  // 1. User Info
  const userName = session?.employee?.fullName || "Alex Carter";
  const employer = session?.employee?.employer || "USM";
  if ($("userName")) $("userName").textContent = userName;
  if ($("menuUserName")) $("menuUserName").textContent = userName;
  if ($("menuUserEmployer")) $("menuUserEmployer").textContent = employer;

  // 2. Metrics & Dynamic Alerts
  const max = session?.plan?.annualMaximum || 1500;
  const used = session?.usage?.annualBenefitUsed || 980;
  const remaining = session?.usage?.annualBenefitRemaining || (max - used);
  const planned = 500; // 3 scheduled procedures: $180 + $200 + $120

  const projectedTotal = used + planned;
  const projectedPct = Math.min(100, Math.round((projectedTotal / max) * 100));
  const projectedRemaining = Math.max(0, max - projectedTotal);
  const remainingPct = Math.max(0.5, (projectedRemaining / max) * 100).toFixed(0);

  // Hydrate Alert 1 (Near Annual Max)
  if ($("alert1Max")) $("alert1Max").textContent = money(max);
  if ($("alert1Used")) $("alert1Used").textContent = `${money(used)} (${Math.round((used / max) * 100)}%)`;
  if ($("alert1Planned")) $("alert1Planned").textContent = `${money(planned)} (${Math.round((planned / max) * 100)}%)`;
  if ($("alert1Remaining")) $("alert1Remaining").textContent = `~${money(projectedRemaining)} (~${remainingPct}%)`;

  if ($("alert1Body")) {
    if (projectedPct >= 90) {
      $("alert1Body").innerHTML = `You currently have <b>${money(remaining)}</b> in available dental benefits. Based on your 3 planned procedures (Filling #1, Filling #2, Crown), you are projected to use <b>${money(planned)}</b>, reaching <b>${projectedPct}%</b> of your ${money(max)} limit with approximately <b>${money(projectedRemaining)} remaining (~${remainingPct}%)</b> before year-end.`;
    } else {
      $("alert1Body").innerHTML = `You currently have <b>${money(remaining)}</b> in available dental benefits. Based on your planned procedures, you will utilize <b>${money(planned)}</b>, bringing your projected usage to <b>${projectedPct}%</b> of your ${money(max)} limit with <b>${money(projectedRemaining)}</b> remaining in reserve.`;
      if ($("alert1Tag")) {
        $("alert1Tag").textContent = "On Track";
        $("alert1Tag").className = "alert-tag green";
      }
    }
  }

  // Hydrate Alert 4 (FSA)
  const fsaBalance = session?.employee?.fsaBalance !== undefined ? session.employee.fsaBalance : 300;
  if ($("alertFsaTag")) $("alertFsaTag").textContent = `${money(fsaBalance)} Available`;
  if ($("alertFsaBody")) {
    $("alertFsaBody").innerHTML = `You have an estimated <b>${money(fsaBalance)}</b> available in your employer Flexible Spending Account (FSA). FSA funds are subject to annual "use-it-or-lose-it" IRS deadlines. You can use these pre-tax funds toward your dental copays and deductible.`;
  }
}

document.addEventListener("DOMContentLoaded", initAlerts);
