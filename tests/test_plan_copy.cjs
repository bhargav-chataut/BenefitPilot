const test = require('node:test');
const assert = require('node:assert/strict');
const {explain} = require('../frontend/plan-copy.js');

const option = {
  name: 'Budget', monthlyBudget: 500, completionMonth: 'Jan 2027',
  scenario: {
    in: {youPay: 660.25, peakMonthlyPayment: 420, benefitRemaining: 869, nextYearUsed: 340},
    out: {youPay: 1200, peakMonthlyPayment: 720, benefitRemaining: 400, nextYearUsed: 0},
  },
};
const fastest = {scenario: {in: {youPay: 1000.25}, out: {youPay: 1100}}};

test('recommendation uses exact computed savings, timing and benefit years', () => {
  const copy = explain(option, fastest);
  assert.match(copy, /\$660.25/);
  assert.match(copy, /Jan 2027/);
  assert.match(copy, /\$420, within your \$500/);
  assert.match(copy, /save \$340 compared with the Fastest schedule/);
  assert.match(copy, /\$869 in benefits remaining this plan year/);
  assert.match(copy, /\$340 in next-year benefits, assuming the same plan renews/);
});
test('network changes update estimates and do not invent savings or affordability', () => {
  const copy = explain(option, fastest, 'out');
  assert.match(copy, /\$720, above your \$500/);
  assert.match(copy, /\$100 more than the Fastest/);
  assert.match(copy, /out-of-network coverage estimates/);
  assert.doesNotMatch(copy, /save|next-year benefits|within your/);
});
test('no annual maximum is not described as zero remaining benefits', () => {
  const copy = explain({...option, scenario: {in: {...option.scenario.in, benefitRemaining: null, nextYearUsed: 0}}}, fastest);
  assert.doesNotMatch(copy, /benefits remaining/);
  assert.equal(explain(null, fastest), '');
});
test('earlier completion discloses extra member cost relative to Budget', () => {
  const copy = explain({...option, id:'premium', name:'Fastest', completionMonth:'Oct 2026'}, fastest, 'in',
    {scenario:{in:{youPay:645.25}}});
  assert.match(copy, /earliest feasible completion in Oct 2026/);
  assert.match(copy, /\$15 more than Budget/);
});
