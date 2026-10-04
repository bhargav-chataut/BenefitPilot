// Shared benefit totals and the employee's accepted dashboard projection.
(() => {
  const base = window.location.protocol === 'file:' ? 'http://localhost:8001' : '';
  const email = localStorage.getItem('benefitPilot.employeeEmail') || '';
  const key = 'benefitPilot.acceptedPlan.v1:' + (email.toLowerCase() || 'demo');
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
  function dashboard() {
    if (!benefits) return null;
    const plan = acceptedPlan();
    const months = benefits.months.map((month, index) => {
      const projected = plan && index >= 9 ? plan.scenario.monthlyBenefitPayments[index - 9] : 0;
      return {...month, actual: month.amount, projectedAmount: projected,
        amount: month.amount + projected, projected: projected > 0};
    });
    return {...benefits, months, projected: plan?.scenario.benefitUsed || 0,
      projectedRemaining: plan?.scenario.benefitRemaining ?? benefits.remaining,
      nextYearProjected: plan?.scenario.nextYearUsed || 0,
      upcoming: plan ? plan.procedures.map((procedure, index) => {
        const month = plan.schedule[index];
        return {date: `${['Oct', 'Nov', 'Dec', 'Jan'][month]} ${month === 3 ? benefits.year + 1 : benefits.year}`,
          procedure: procedure.name, provider: plan.provider, href: 'results.html'};
      }) : [],
    };
  }
  function alertsData() {
    if (!benefits) return {lastUpdated: 'Unavailable', alerts: [], snapshot: null, dates: [], past: []};
    const plan = acceptedPlan();
    const low = benefits.annualMax > 0 && benefits.remaining / benefits.annualMax < 0.8;
    return {
      lastUpdated: 'Current benefit totals', snapshot: benefits,
      alerts: low ? [{id: `remaining-${benefits.year}-${benefits.remaining}`, read: false, status: 'active',
        type: 'warning', icon: 'clock', title: `You have ${money(benefits.remaining)} of your annual dental benefit remaining`,
        body: `${Math.round(benefits.remaining / benefits.annualMax * 100)}% of your ${money(benefits.annualMax)} annual maximum remains.`,
        pill: 'View benefits', href: 'dashboard.html', createdAt: `${benefits.year}-10-01T00:00:00Z`}] : [],
      dates: [{label: 'Next benefit reset', date: `Jan 1, ${benefits.year + 1}`, color: 'blue'},
        ...(plan ? [{label: 'Added plan completes', date: `${['Oct', 'Nov', 'Dec', 'Jan'][Math.max(...plan.schedule)]} ${Math.max(...plan.schedule) === 3 ? benefits.year + 1 : benefits.year}`, color: 'blue'}] : [])],
      past: [],
    };
  }
  async function savePlan(payload) {
    const response = await fetch(base + '/api/project', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...payload, employeeEmail: email})});
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || 'Could not add this plan.');
    // Replacing the accepted plan makes repeated clicks idempotent.
    localStorage.setItem(key, JSON.stringify(plan));
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
  window.BenefitData = {ready: load(), dashboard, alertsData, acceptedPlan, savePlan};
})();
