const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('frontend/notifications.js', 'utf8');

const fixture = {
  alerts: [1, 2, 3, 4].map(id => ({id, read: false, status: 'active', title: 'Alert ' + id, body: 'Details'})),
  past: [1, 2, 3].map(id => ({id: 'past-' + id, read: true, status: 'resolved'})),
};
async function page(storage = new Map(), data = fixture) {
  const documentEvents = {}, windowEvents = {};
  const badge = {setAttribute() {}};
  const popupItems = {innerHTML: ''};
  const card = {
    dataset: {alertId: '1'}, classes: new Set(), label: {},
    querySelector() {return this.label;},
  };
  card.classList = {toggle(name, on) { on ? card.classes.add(name) : card.classes.delete(name); }};
  const window = {
    location: {href: 'http://localhost/frontend/alerts.html', origin: 'http://localhost'},
    addEventListener(name, handler) {windowEvents[name] = handler;},
    dispatchEvent(event) {windowEvents[event.type]?.(event);},
  };
  vm.runInNewContext(code, {
    window, URL, Event,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    document: {
      querySelector: () => null,
      getElementById: id => id === 'notification-items' ? popupItems : null,
      querySelectorAll: selector => selector === '[data-unread-count]' ? [badge] : [card],
      addEventListener(name, handler) {documentEvents[name] = handler;},
    },
    fetch: async () => ({ok: data !== null, json: async () => data}),
  });
  await window.BenefitNotifications.ready;
  return {api: window.BenefitNotifications, badge, card, popupItems, documentEvents, windowEvents};
}

test('opening marks read immediately without archiving, and survives navigation', async () => {
  const storage = new Map();
  const first = await page(storage);
  assert.equal(first.badge.textContent, 4);
  assert.equal(first.api.getData().past.length, 3);
  const link = {dataset: {alertId: '1'}, closest: () => null};
  first.documentEvents.click({target: {closest: selector => selector === '[data-alert-id]' ? link : null}});
  assert.equal(first.badge.textContent, 3);
  assert.equal(first.api.getData().alerts.length, 4);
  assert.equal(first.api.getData().alerts[0].read, true);
  assert.equal(first.api.getData().past.length, 3);
  assert.ok(first.card.classes.has('is-read'));
  assert.equal(first.card.label.textContent, 'Read');
  assert.ok(!first.popupItems.innerHTML.includes('data-alert-id="1"'));
  assert.equal((await page(storage)).badge.textContent, 3);
});

test('same shared unread count across tabs; zero count is hidden', async () => {
  const storage = new Map();
  const first = await page(storage), second = await page(storage);
  for (const alert of first.api.getData().alerts) first.api.markRead(alert.id);
  second.windowEvents.storage({key: 'benefitPilot.alertState.v1:demo'});
  assert.equal(second.badge.textContent, 0);
  assert.equal(second.badge.hidden, true);
  assert.equal(second.api.getData().alerts.length, 4);
  assert.match(second.popupItems.innerHTML, /No unread alerts/);
});

test('read state is isolated by employee', async () => {
  const storage = new Map([['benefitPilot.employeeEmail', 'alex@example.com']]);
  (await page(storage)).api.markRead(1);
  storage.set('benefitPilot.employeeEmail', 'sam@example.com');
  assert.equal((await page(storage)).api.unread().length, 4);
  storage.set('benefitPilot.employeeEmail', 'ALEX@example.com');
  assert.equal((await page(storage)).api.unread().length, 3);
});

test('only expiration/resolution archives, not read state; popup sorts newest first', async () => {
  const data = {alerts: [
    {id: 'old', read: false, createdAt: '2026-01-01'},
    {id: 'new', read: false, createdAt: '2026-02-01'},
    {id: 'read', read: true},
    {id: 'expired', read: false, expiresAt: '2000-01-01'},
    {id: 'resolved', read: false, status: 'resolved'},
  ], past: []};
  const {api} = await page(new Map(), data);
  assert.equal(api.getData().alerts.length, 3);
  assert.equal(api.getData().past.length, 2);
  assert.equal(api.unread().map(a => a.id).join(','), 'new,old');
  api.markRead('new');
  assert.equal(api.getData().alerts.length, 3);
  api.clearPast();
  assert.equal(api.getData().past.length, 0);
  assert.equal(api.getData().alerts.length, 3);
});

test('corrupt cache falls back and unsafe links are rejected', async () => {
  const {api} = await page(new Map([['benefitPilot.alertState.v1:demo', '{broken']]));
  assert.equal(api.unread().length, 4);
  assert.equal(api.safeHref('javascript:alert(1)'), '#');
  assert.equal(api.safeHref('https://other.example/'), '#');
  assert.equal(api.safeHref('results.html'), 'http://localhost/frontend/results.html');
});

test('all three pages load shared notifications and include a badge', () => {
  for (const name of ['dashboard', 'results', 'alerts']) {
    const html = fs.readFileSync(`frontend/${name}.html`, 'utf8');
    assert.match(html, /data-unread-count/);
    assert.match(html, /href="notifications.css"/);
    assert.ok(html.indexOf('src="notifications.js"') < html.indexOf(`src="${name}.js"`));
  }
});
