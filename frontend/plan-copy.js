/* Copy derived from computed scenarios; never infer savings or clinical eligibility. */
((root) => {
  const money = value => '$' + Number(value).toLocaleString('en-US', {maximumFractionDigits: 2});
  function explain(option, fastest, network = 'in', budget) {
    if (!option) return '';
    const scenario = option.scenario[network];
    const peak = scenario.peakMonthlyPayment;
    const target = option.monthlyBudget;
    const comparison = fastest?.scenario[network];
    const savings = comparison ? Math.round((comparison.youPay - scenario.youPay) * 100) / 100 : 0;
    const opening = option.id === 'premium'
      ? `Fastest offers the earliest feasible completion in ${option.completionMonth}, with an estimated member cost of ${money(scenario.youPay)}.`
      : `${option.name} has an estimated member cost of ${money(scenario.youPay)} and completes treatment in ${option.completionMonth}.`;
    const sentences = [opening];
    if (Number.isFinite(peak) && Number.isFinite(target)) {
      sentences.push(`Its estimated peak monthly responsibility is ${money(peak)}, ${peak <= target ? 'within' : 'above'} your ${money(target)} monthly cost target.`);
    }
    if (savings > 0) {
      sentences.push(`This strategy is estimated to save ${money(savings)} compared with the Fastest schedule.`);
    } else if (savings < 0) {
      sentences.push(`This strategy costs an estimated ${money(-savings)} more than the Fastest schedule.`);
    }
    if (option.id !== 'budget' && budget) {
      const extra = Math.round((scenario.youPay - budget.scenario[network].youPay) * 100) / 100;
      if (extra > 0) sentences.push(`It costs an estimated ${money(extra)} more than Budget.`);
      else if (extra === 0) sentences.push('It has the same estimated member cost as Budget.');
    }
    if (scenario.benefitRemaining != null) {
      sentences.push(`It leaves an estimated ${money(scenario.benefitRemaining)} in benefits remaining this plan year.`);
    }
    if (scenario.nextYearUsed > 0) {
      sentences.push(`The estimate applies ${money(scenario.nextYearUsed)} in next-year benefits, assuming the same plan renews.`);
    }
    sentences.push(`Based on ${network === 'out' ? 'out-of-network' : 'in-network'} coverage estimates.`);
    return sentences.join(' ');
  }
  const api = {explain};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BenefitPlanCopy = api;
})(globalThis);
