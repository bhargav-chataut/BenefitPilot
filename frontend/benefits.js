// Shared benefit totals and the employee's accepted dashboard projection.
(() => {
  const base = window.location.protocol === 'file:' ? 'http://localhost:8001' : '';
  const email = localStorage.getItem('benefitPilot.employeeEmail') || '';
  const key = 'benefitPilot.activePlan';
  let benefits = null;
  const money = value => '$' + Number(value).toLocaleString('en-US');
  function acceptedPlan() {
    try {
      const plan = JSON.parse(localStorage.getItem(key) || 'null');
      if (!plan || !benefits || plan.email.toLowerCase() !== benefits.email.toLowerCase()
          || plan.year !== benefits.year || !Array.isArray(plan.scenario?.monthlyBenefitPayments)
          || plan.insurance.annualBenefitUsed !== benefits.used
          || plan.insurance.annualMaximum !== benefits.annualMax
          || plan.insurance.remainingDeductible !== benefits.insurance.remainingDeductible) return null;
      return plan;
    } catch { return null; }
  }
  function projection() {
    const plan = acceptedPlan();
    const currentYearPlanPays = plan?.scenario?.benefitUsed || 0;
    const nextYearPlanPays = plan?.scenario?.nextYearUsed || 0;
    const monthly = Array(12).fill(0);
    if (plan?.scenario?.monthlyBenefitPayments) {
      plan.scenario.monthlyBenefitPayments
        .slice(0, 3)
        .forEach((amount, index) => { monthly[index + 9] = amount; });
    }
    return {
      plan,
      hasPlan: Boolean(plan),
      used: benefits.used,
      projected: currentYearPlanPays,
      remaining: Math.max(0, benefits.annualMax - benefits.used - currentYearPlanPays),
      nextYearProjected: nextYearPlanPays,
      monthly,
    };
  }
  function dashboard() {
    if (!benefits) return null;
    const snapshot = projection();
    const months = benefits.months.map((month, index) => {
      const projected = snapshot.monthly[index];
      return {...month, actual: month.amount, projectedAmount: projected,
        amount: month.amount + projected, projected: projected > 0};
    });
    return {...benefits, ...snapshot, months,
      projectedRemaining: snapshot.remaining,
      upcoming: snapshot.plan ? snapshot.plan.procedures.map((procedure, index) => {
        const month = snapshot.plan.schedule[index];
        return {date: `${['Oct', 'Nov', 'Dec', 'Jan'][month]} ${month === 3 ? benefits.year + 1 : benefits.year}`,
          procedure: procedure.name, provider: snapshot.plan.provider, status: 'Scheduled'};
      }) : [],
    };
  }
  function alertsData() {
    if (!benefits) return {lastUpdated: 'Unavailable', alerts: [], snapshot: null, dates: [], past: []};
    const snapshot = projection();
    const low = benefits.annualMax > 0 && benefits.remaining / benefits.annualMax < 0.8;
    return {
      lastUpdated: 'Current benefit totals',
      snapshot: {...benefits, ...snapshot, projectedRemaining: snapshot.remaining},
      alerts: low ? [{id: `remaining-${benefits.year}-${benefits.remaining}`, read: false, status: 'active',
        type: 'warning', icon: 'clock', title: `You have ${money(benefits.remaining)} of your annual dental benefit remaining`,
        body: `${Math.round(benefits.remaining / benefits.annualMax * 100)}% of your ${money(benefits.annualMax)} annual maximum remains.`,
        pill: 'View benefits', href: 'dashboard.html', createdAt: `${benefits.year}-10-01T00:00:00Z`}] : [],
      dates: [{label: 'Next benefit reset', date: `Jan 1, ${benefits.year + 1}`, color: 'blue'},
        ...(snapshot.plan ? [{label: 'Added plan completes', date: `${['Oct', 'Nov', 'Dec', 'Jan'][Math.max(...snapshot.plan.schedule)]} ${Math.max(...snapshot.plan.schedule) === 3 ? benefits.year + 1 : benefits.year}`, color: 'blue'}] : [])],
      past: [],
    };
  }
  async function savePlan(payload) {
    const response = await fetch(base + '/api/project', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...payload, employeeEmail: email})});
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || 'Could not add this plan.');
    // Replacing the accepted plan makes repeated clicks idempotent.
    localStorage.setItem(key, JSON.stringify({
      ...plan,
      optionId: payload.optionId || 'balanced',
      currentYearPlanPays: plan.scenario.benefitUsed,
      nextYearPlanPays: plan.scenario.nextYearUsed,
      projectedMonthlyPayments: plan.scenario.monthlyBenefitPayments,
      savedAt: new Date().toISOString(),
    }));
    window.dispatchEvent(new Event('benefit-plan-changed'));
    return plan;
  }
  async function load() {
    try {
      const response = await fetch(base + '/api/benefits?employeeEmail=' + encodeURIComponent(email));
      if (!response.ok) throw new Error('Benefits unavailable');
      benefits = await response.json();
    } catch { benefits = null; }
    return benefits;
  }
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) window.dispatchEvent(new Event('benefit-plan-changed'));
  });
  window.BenefitData = {ready: load(), dashboard, alertsData, acceptedPlan, projection, savePlan};
})();
