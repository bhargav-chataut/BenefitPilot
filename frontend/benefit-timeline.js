/* ================= BENEFIT TIMELINE PAGE LOGIC ================= */
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n).toLocaleString("en-US");

function getSavedSession() {
  try {
    return JSON.parse(sessionStorage.getItem("benefitpilot_session") || "null");
  } catch {
    return null;
  }
}

function initTimelinePage() {
  const session = getSavedSession();

  // Benchmark default values
  let max = 1500;
  let used = 980;
  let planned = 500;
  let resetDate = "Jan 1, 2027";

  // Merge session if available
  if (session?.plan?.annualMaximum) {
    max = Number(session.plan.annualMaximum);
  }
  if (session?.usage?.annualBenefitUsed !== undefined) {
    used = Number(session.usage.annualBenefitUsed);
  }

  const projectedTotal = used + planned;
  const projectedPct = Math.min(100, Math.round((projectedTotal / max) * 100));
  const projectedRemaining = Math.max(0, max - projectedTotal);
  const usedPct = Math.round((used / max) * 100);

  // SECTION 1: SUMMARY ROW
  if ($("tMax")) $("tMax").textContent = money(max);
  if ($("tUsed")) $("tUsed").textContent = money(used);
  if ($("tUsedMeta")) $("tUsedMeta").textContent = `${usedPct}% claims paid`;
  if ($("tPlanned")) $("tPlanned").textContent = money(planned);
  if ($("tPlannedMeta")) $("tPlannedMeta").textContent = "3 scheduled treatments";
  if ($("tRemaining")) $("tRemaining").textContent = `~${money(projectedRemaining)}`;
  if ($("tRemainingMeta")) {
    $("tRemainingMeta").textContent = `~${Math.round((projectedRemaining / max) * 100)}% buffer at year-end`;
  }
  if ($("tReset")) $("tReset").textContent = resetDate;

  // SECTION 2: TIMELINE BANNER
  if ($("tPastBannerText")) {
    $("tPastBannerText").textContent = `Jan – Sep 2026: ${money(used)} Paid Claims`;
  }

  // SECTION 3: INSIGHT
  if ($("tInsightPrimary")) {
    if (projectedPct >= 90) {
      $("tInsightPrimary").innerHTML = `Based on your planned care, your remaining annual benefit may be <b>nearly exhausted (${money(projectedTotal)} of ${money(max)}, or about ${projectedPct}% used)</b> by the end of the year.`;
    } else {
      $("tInsightPrimary").innerHTML = `Based on your planned care, you are projected to use <b>${projectedPct}% of your annual benefit (${money(projectedTotal)} of ${money(max)})</b>, leaving <b>${money(projectedRemaining)}</b> in reserve before the reset.`;
    }
  }

  if ($("tInsightOpportunity")) {
    if (projectedPct >= 90) {
      $("tInsightOpportunity").textContent = "Moving eligible care into the next plan year may shift benefit usage into the renewed annual maximum.";
    } else {
      $("tInsightOpportunity").textContent = "Your planned appointments fit comfortably within your current year maximum.";
    }
  }
}

document.addEventListener("DOMContentLoaded", initTimelinePage);
