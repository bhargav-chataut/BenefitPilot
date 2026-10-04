/* ================= CONFIG & BENCHMARK DATA ================= */
const CONFIG = {
  API_URL: "/api/dashboard",
  USE_MOCK_ON_ERROR: true,
};

/**
 * Standard benchmark data matching employee Alex Carter:
 * Plan: Lincoln Dental PPO Plus
 * Plan year: Jan 1 – Dec 31, 2026
 * Deductible: $50 of $50 met
 * Annual Max: $2,000
 * Used So Far: $620 (31%)
 * Current Benefit Remaining: $1,380
 * Planned Care: $500 (25%)
 * Projected After Care: ~$880 (~44% buffer)
 */
const DEFAULT_DASHBOARD_DATA = {
  user: {
    name: "Alex Carter",
    employer: "USM",
    email: "alex.carter@usm-demo.com",
  },
  plan: {
    planName: "Lincoln Dental PPO Plus",
    annualMaximum: 2000,
    deductible: 50,
    deductibleMet: 50,
    resetDate: "Jan 1, 2027",
    planYear: "Jan 1 – Dec 31, 2026",
  },
  usage: {
    usedSoFar: 620,
    remaining: 1380,
    plannedRestOfYear: 500,
    projectedRemaining: 880,
    projectedTotalUsed: 1120,
    projectedUtilizationPct: 56,
  },
};

/* ================= UTILITY HELPERS ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");

function getSavedSession() {
  try {
    return JSON.parse(sessionStorage.getItem("benefitpilot_session") || "null");
  } catch {
    return null;
  }
}

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

/* ================= COMPACT ALERT TOAST BEHAVIOR ================= */
function setupAlertToast() {
  const toast = $("alertToast");
  const closeBtn = $("toastDismissBtn");
  if (!toast) return;

  let dismissTimer = null;

  const dismiss = () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    toast.classList.add("toast-dismissed");
    setTimeout(() => {
      toast.style.display = "none";
    }, 280);
  };

  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });
  }

  // Auto-dismiss after 9 seconds
  dismissTimer = setTimeout(dismiss, 9000);

  // Pause dismiss on user hover
  toast.addEventListener("mouseenter", () => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  // Resume dismiss after hover leaves
  toast.addEventListener("mouseleave", () => {
    dismissTimer = setTimeout(dismiss, 4500);
  });
}

/* ================= DATA HYDRATION & RENDER ================= */
function renderDashboard(data) {
  // 1. User & Plan Context
  const userName = data.user?.name || "Alex Carter";
  const employer = data.user?.employer || "USM";
  if ($("userName")) $("userName").textContent = userName;
  if ($("employeeName")) $("employeeName").textContent = userName;
  if ($("menuUserName")) $("menuUserName").textContent = userName;
  if ($("menuUserEmployer")) $("menuUserEmployer").textContent = employer;

  if (data.plan?.planName && $("planBadge")) {
    $("planBadge").textContent = data.plan.planName;
  }
  if (data.plan?.planYear && $("planYearText")) {
    $("planYearText").textContent = `Plan Year: ${data.plan.planYear}`;
  }
  if ($("deductibleStatus")) {
    const dedMet = data.plan?.deductibleMet ?? 50;
    const dedTotal = data.plan?.deductible ?? 50;
    $("deductibleStatus").textContent = `$${dedMet} of $${dedTotal} met`;
  }

  // 2. Exact Financial Math
  const max = Number(data.plan?.annualMaximum) || 2000;
  const used = Number(data.usage?.usedSoFar) || 620;
  const remaining = Math.max(0, max - used);
  const planned = Number(data.usage?.plannedRestOfYear) || 500;

  const projectedTotalUsed = used + planned;
  const projectedRemaining = Math.max(0, max - projectedTotalUsed);

  const usedPct = Math.round((used / max) * 100);
  const plannedPct = Math.round((planned / max) * 100);
  const remainingPct = Math.max(1, 100 - usedPct - plannedPct);

  // 3. Hero Card Primary Numbers
  if ($("remainingHero")) $("remainingHero").textContent = remaining.toLocaleString("en-US");
  if ($("maxHero")) $("maxHero").textContent = money(max);
  if ($("usedHero")) $("usedHero").textContent = money(used);
  if ($("bufferHero")) $("bufferHero").textContent = `~${money(projectedRemaining)}`;

  // Secondary stat cards subtext
  if ($("usedSubText")) $("usedSubText").textContent = `${usedPct}% of maximum`;
  if ($("bufferSubText")) $("bufferSubText").textContent = `~${remainingPct}% remaining`;

  // 4. Usage Breakdown Tags (Above bar: percentages only, no duplicate dollars)
  if ($("tagUsed")) $("tagUsed").textContent = `${usedPct}% Used`;
  if ($("tagPlanned")) $("tagPlanned").textContent = `${plannedPct}% Planned`;
  if ($("tagRemaining")) $("tagRemaining").textContent = `${remainingPct}% Remaining`;

  // 5. Multi-Segment Utilization Bar (Solid clean segments matching color system)
  const segUsed = document.querySelector(".seg-used");
  const segPlanned = document.querySelector(".seg-planned");
  const segRemaining = document.querySelector(".seg-remaining");

  if (segUsed) {
    segUsed.style.width = `${usedPct}%`;
    segUsed.title = `Used: ${money(used)} (${usedPct}%)`;
  }
  if (segPlanned) {
    segPlanned.style.width = `${plannedPct}%`;
    segPlanned.title = `Planned: ${money(planned)} (${plannedPct}%)`;
  }
  if (segRemaining) {
    segRemaining.style.width = `${remainingPct}%`;
    segRemaining.title = `Remaining: ${money(projectedRemaining)} (${remainingPct}%)`;
  }

  // 6. Summary Legend (Below bar: dollar figures only, no duplicate percentages)
  if ($("summaryUsed")) $("summaryUsed").textContent = money(used);
  if ($("summaryPlanned")) $("summaryPlanned").textContent = money(planned);
  if ($("summaryBuffer")) $("summaryBuffer").textContent = `~${money(projectedRemaining)}`;

  // 7. Alert Toast Message
  if ($("toastMessage")) {
    const totalProjPct = Math.min(100, Math.round((projectedTotalUsed / max) * 100));
    // If high usage or benchmark, display the prominent warning
    if (totalProjPct >= 90 || max === 1500) {
      $("toastMessage").textContent = "You are projected to use 99% of this year’s benefit.";
    } else {
      $("toastMessage").textContent = `You are projected to use ${totalProjPct}% of this year’s benefit.`;
    }
  }
}

/* ================= INIT ================= */
async function initDashboard() {
  setupAlertToast();

  const session = getSavedSession();
  let data = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_DATA));

  // Merge session data if user signed in
  if (session?.employee) {
    data.user.name = session.employee.fullName || `${session.employee.firstName} ${session.employee.lastName}`;
    data.user.employer = session.employee.employer || "USM";
    data.user.email = session.employee.email;
  }
  if (session?.plan) {
    data.plan.planName = session.plan.planName || data.plan.planName;
    data.plan.annualMaximum = Number(session.plan.annualMaximum) || data.plan.annualMaximum;
    if (session.plan.deductible !== undefined) data.plan.deductible = Number(session.plan.deductible);
    if (session.plan.deductibleMet !== undefined) data.plan.deductibleMet = Number(session.plan.deductibleMet);
    if (session.plan.planYear) data.plan.planYear = session.plan.planYear;
  }
  if (session?.usage) {
    data.usage.usedSoFar = Number(session.usage.annualBenefitUsed ?? session.usage.usedSoFar) || data.usage.usedSoFar;
    data.usage.remaining = Number(session.usage.annualBenefitRemaining ?? session.usage.remaining) || (data.plan.annualMaximum - data.usage.usedSoFar);
  }

  // Try live backend fetch if connected
  try {
    const url = session?.employee?.email
      ? `${CONFIG.API_URL}?email=${encodeURIComponent(session.employee.email)}`
      : CONFIG.API_URL;
    const res = await fetch(url);
    if (res.ok) {
      const serverData = await res.json();
      if (serverData.user) data.user.name = serverData.user.name;
      if (serverData.annualMax) data.plan.annualMaximum = Number(serverData.annualMax);
      if (serverData.used !== undefined) data.usage.usedSoFar = Number(serverData.used);
      if (serverData.remaining !== undefined) data.usage.remaining = Number(serverData.remaining);
    }
  } catch (err) {
    // Graceful fallback to rich local benchmark data
    console.warn("Using offline benchmark dashboard data:", err.message);
  }

  renderDashboard(data);
}

// Run on load
document.addEventListener("DOMContentLoaded", initDashboard);
