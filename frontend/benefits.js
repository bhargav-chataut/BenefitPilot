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
      remaining: plan
        ? Math.max(0, benefits.annualMax - benefits.used - currentYearPlanPays)
        : benefits.remaining,
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
    return {...benefits, ...snapshot, remaining: benefits.remaining, months,
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
    const low = benefits.annualMax > 0 && snapshot.remaining / benefits.annualMax < 0.2;
    const active = snapshot.plan;
    const target = Number(String(active?.settings?.budget || '').replace(/[$,]/g, ''));
    const peak = active?.scenario?.peakMonthlyPayment;
    const nextYearCount = active?.schedule.filter(month => month === 3).length || 0;
    const planAlerts = [];
    const addAlert = (id, type, title, body) => planAlerts.push({
      id: `${id}-${benefits.year}-${active?.savedAt || 'plan'}`, read: false,
      status: 'active', type, icon: 'info', title, body,
      pill: 'Review care plan', href: 'results.html', createdAt: active?.savedAt,
    });
    if (nextYearCount > 0 && snapshot.nextYearProjected > 0) {
      addAlert('next-year', 'info', 'Your selected schedule uses next-year benefits',
        `${nextYearCount} planned ${nextYearCount === 1 ? 'procedure is' : 'procedures are'} scheduled in the next benefit year, with ${money(snapshot.nextYearProjected)} in estimated plan contributions. This assumes the same plan renews.`);
    }
    if (active?.network === 'out') {
      addAlert('network', 'warning', 'Your selected coverage estimate is out of network',
        'Your estimated member responsibility may be higher than with an in-network provider. Confirm your provider’s network status before scheduling.');
    }
    if (target > 0 && Number.isFinite(peak) && peak > target) {
      addAlert('monthly-target', 'warning', 'Your monthly cost target may be exceeded',
        `The current schedule has an estimated peak monthly responsibility of ${money(peak)}, above your ${money(target)} target.`);
    }
    const unusedReminder = !low && benefits.annualMax > 0 && snapshot.remaining > 0 ? [{
      id: `unused-${benefits.year}`,
      read: true,
      status: 'active',
      type: 'success',
      icon: 'calendar',
      title: snapshot.hasPlan
        ? `${money(snapshot.remaining)} in benefits would remain after planned care`
        : `${money(snapshot.remaining)} in dental benefits remains this plan year`,
      body: 'You have unused coverage available before your benefit year resets.',
      pill: 'View benefits',
      href: 'dashboard.html',
      createdAt: `${benefits.year}-12-01T00:00:00Z`,
    }] : [];
    return {
      lastUpdated: 'Current benefit totals',
      snapshot: {...benefits, ...snapshot, projectedRemaining: snapshot.remaining},
      alerts: [
        ...(low ? [{id: `remaining-${benefits.year}-${snapshot.remaining}`, read: false, status: 'active',
        type: 'warning', icon: 'clock',
        title: snapshot.hasPlan
          ? `${money(snapshot.remaining)} in benefits would remain after planned care`
          : `${money(snapshot.remaining)} in dental benefits remains this plan year`,
        body: `Less than 20% of your ${money(benefits.annualMax)} annual plan benefit ${snapshot.hasPlan ? 'would remain after your selected care plan' : 'is available before your benefit year resets'}.`,
        pill: 'View benefits', href: 'dashboard.html', createdAt: `${benefits.year}-10-01T00:00:00Z`}] : []),
        ...unusedReminder,
        ...planAlerts,
      ],
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
