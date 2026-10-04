const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('frontend/benefits.js', 'utf8');
const baseline = {email:'alex@example.com', name:'Alex', year:2026, annualMax:1500, used:300, remaining:1200,
  insurance: {annualBenefitUsed:300, annualMaximum:1500, remainingDeductible:0},
  months: Array.from({length:12}, (_, i) => ({month:String(i+1), amount:i === 1 ? 300 : 0})),
};
const plan = {email:baseline.email, year:2026, insurance:baseline.insurance, provider:'Dentist',
  procedures:[{name:'Filling'},{name:'Crown'}], schedule:[0,3],
  scenario:{monthlyBenefitPayments:[200,0,0,500], benefitUsed:200, benefitRemaining:1000, nextYearUsed:500},
};
async function setup(data = baseline, storage = new Map(), projection = plan) {
  const listeners = {}, events = [];
  const window = {location:{protocol:'http:'}, addEventListener:(name, handler)=>listeners[name]=handler,
    dispatchEvent:event=>events.push(event.type)};
  vm.runInNewContext(code, {window, Event,
    localStorage:{getItem:key=>storage.get(key) || null, setItem:(key,val)=>storage.set(key,val)},
    fetch:async url=>({ok:true, json:async()=>url.includes('/api/project') ? projection : data}),
  });
  await window.BenefitData.ready;
  return {api:window.BenefitData, storage, events, listeners};
}
test('benefit alert threshold is strictly below 20 percent', async()=>{
  for (const remaining of [301,300,299]) {
    const {api} = await setup({...baseline, remaining});
    assert.equal(api.alertsData().alerts.filter(alert => alert.type === 'warning').length, remaining < 300 ? 1 : 0);
    assert.equal(api.alertsData().snapshot.remaining, api.dashboard().remaining);
  }
});
test('adding plan updates projection, not actual usage; January stays next year', async()=>{
  const {api, events} = await setup();
  assert.equal(api.dashboard().projected, 0);
  await api.savePlan({});
  const dashboard = api.dashboard();
  assert.equal(dashboard.used, 300);
  assert.equal(dashboard.remaining, 1200);
  assert.equal(dashboard.projected, 200);
  assert.equal(dashboard.projectedRemaining, 1000);
  assert.equal(dashboard.nextYearProjected, 500);
  assert.equal(dashboard.months[9].projectedAmount, 200);
  assert.equal(dashboard.months[0].projectedAmount, 0);
  assert.equal(dashboard.upcoming.length, 2);
  assert.ok(events.includes('benefit-plan-changed'));
});
test('repeated adds replace instead of double count and survive reload', async()=>{
  const {api, storage} = await setup();
  await api.savePlan({});
  await api.savePlan({});
  assert.equal(api.dashboard().projected, 200);
  assert.equal((await setup(baseline, storage)).api.dashboard().projected, 200);
  storage.set('benefitPilot.employeeEmail','other@example.com');
  assert.equal((await setup({...baseline,email:'other@example.com'}, storage)).api.dashboard().projected, 0);
});
test('old projection is ignored if actual benefits change', async()=>{
  const {api, storage} = await setup();
  await api.savePlan({});
  const updated = await setup({...baseline, used:400, remaining:1100}, storage);
  assert.equal(updated.api.dashboard().projected, 0);
});

test('alerts include simulated email status for remaining benefits', async()=>{
  const {api} = await setup({...baseline, remaining:520});
  const alert = api.alertsData().alerts[0];
  assert.equal(alert.title, 'You still have unused dental benefits that may expire at the end of the year.');
  assert.match(alert.body, /Use your remaining benefits before they reset\./);
  assert.match(alert.body, /Email sent to alex@example.com\./);
});
test('plan alerts are gated by computed next-year use, network and monthly target', async()=>{
  const saved = {...plan, network:'out', settings:{budget:'$500'},
    scenario:{...plan.scenario, peakMonthlyPayment:720}};
  const {api} = await setup(baseline, new Map(), saved);
  assert.equal(api.alertsData().alerts.length, 1);
  await api.savePlan({});
  const alerts = api.alertsData().alerts;
  assert.ok(alerts.some(a=>a.title === 'Your selected schedule uses next-year benefits' && a.body.includes('$500')));
  assert.ok(alerts.some(a=>a.title === 'Your selected coverage estimate is out of network'));
  assert.ok(alerts.some(a=>a.body.includes('$720, above your $500 target')));
  assert.ok(alerts.every(a=>!a.body.includes('save')));
});
test('no monthly alert at target, no network alert in network, no unfunded next-year claim', async()=>{
  const saved = {...plan, network:'in', settings:{budget:'$500'},
    scenario:{...plan.scenario, peakMonthlyPayment:500, nextYearUsed:0}};
  const {api} = await setup(baseline, new Map(), saved);
  await api.savePlan({});
  assert.equal(api.alertsData().alerts.length, 1);
});
