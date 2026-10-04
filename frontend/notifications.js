/* Shared notification feed and per-account hackathon read state. */
(() => {
const DEMO = {lastUpdated: 'Unavailable', alerts: [], snapshot: null, dates: [], past: []};
  const esc = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeHref(value) {
    try {
      const url = new URL(value || '#', window.location.href);
      return url.origin === window.location.origin && ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : '#';
    } catch { return '#'; }
  }
  function accountKey() {
    try { return 'benefitPilot.alertState.v1:' + (localStorage.getItem('benefitPilot.employeeEmail') || 'demo').toLowerCase(); }
    catch { return 'benefitPilot.alertState.v1:demo'; }
  }
  const key = accountKey();
  function readStored() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      return {
        read: Array.isArray(value?.read) ? value.read.map(String) : [],
        cleared: Array.isArray(value?.cleared) ? value.cleared.map(String) : [],
      };
    } catch { return {read: [], cleared: []}; }
  }
  let saved = readStored();
  let source = DEMO;
  const archived = alert => ['expired', 'resolved'].includes(alert.status)
    || (alert.expiresAt && Date.parse(alert.expiresAt) <= Date.now());
  function getData() {
    const all = [...source.alerts, ...source.past].map(alert => ({
      ...alert, read: alert.read === true || saved.read.includes(String(alert.id)),
    }));
    return {...source,
      alerts: all.filter(alert => !archived(alert)),
      past: all.filter(alert => archived(alert) && !saved.cleared.includes(String(alert.id))),
    };
  }
  function unread() {
    return getData().alerts.filter(alert => !alert.read)
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }
  function persist() {
    const latest = readStored();
    saved.read = [...new Set([...latest.read, ...saved.read])];
    saved.cleared = [...new Set([...latest.cleared, ...saved.cleared])];
    try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* Keep working in memory. */ }
  }
  function markRead(id) {
    id = String(id);
    if (!getData().alerts.some(alert => String(alert.id) === id)) return;
    saved.read = [...new Set([...saved.read, id])];
    persist();
    refresh();
  }
  function clearPast() {
    saved.cleared.push(...getData().past.map(alert => String(alert.id)));
    persist();
    refresh();
  }

  const user = document.querySelector('.user');
  if (user) {
    const toolbar = document.createElement('div');
    toolbar.className = 'notification-toolbar';
    user.before(toolbar);
    toolbar.innerHTML = `<div class="notifications">
      <button type="button" class="notification-toggle" aria-expanded="false" aria-controls="notification-popup" aria-label="Alerts">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V10a6 6 0 0 1 12 0v7l2 2H4l2-2zM10 22h4"/></svg>
        <span>Alerts</span><span class="notification-badge" data-unread-count hidden>0</span>
      </button>
      <section id="notification-popup" class="notification-popup" aria-label="Unread alerts" hidden>
        <h2>Unread alerts</h2><div id="notification-items"></div>
        <a class="notification-view-all" href="alerts.html">View all alerts</a>
      </section></div>`;
    toolbar.append(user);
  }
  const toggle = document.querySelector('.notification-toggle');
  const popup = document.getElementById('notification-popup');
  function closePopup(restoreFocus = false) {
    if (!popup) return;
    popup.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  toggle?.addEventListener('click', () => {
    popup.hidden = !popup.hidden;
    toggle.setAttribute('aria-expanded', String(!popup.hidden));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popup && !popup.hidden) closePopup(true);
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-alert-id]');
    if (link) {
      // Persist before the link navigates; opening never archives an alert.
      markRead(link.dataset.alertId);
      if (link.closest('.notification-popup')) closePopup(true);
    }
    if (!event.target.closest('.notifications')) closePopup();
  });
  document.addEventListener('auxclick', event => {
    const link = event.target.closest('[data-alert-id]');
    if (event.button === 1 && link) markRead(link.dataset.alertId);
  });
  function refresh() {
    const alerts = unread();
    document.querySelectorAll('[data-unread-count]').forEach(badge => {
      badge.textContent = alerts.length;
      badge.hidden = alerts.length === 0;
      badge.setAttribute('aria-label', `${alerts.length} unread alerts`);
    });
    toggle?.setAttribute('aria-label', `Alerts, ${alerts.length} unread`);
    const list = document.getElementById('notification-items');
    if (list) list.innerHTML = alerts.length ? alerts.slice(0, 5).map(alert =>
      `<a class="notification-item" data-alert-id="${esc(alert.id)}" href="${esc(safeHref(alert.href))}"><strong>${esc(alert.title)}</strong><span>${esc(alert.body)}</span></a>`
    ).join('') : '<p class="notification-empty">No unread alerts.</p>';
    const current = getData().alerts;
    document.querySelectorAll('.al[data-alert-id]').forEach(card => {
      const alert = current.find(item => String(item.id) === card.dataset.alertId);
      if (!alert) return;
      card.classList.toggle('is-read', alert.read);
      card.classList.toggle('is-unread', !alert.read);
      const label = card.querySelector('.alert-read-label');
      if (label) label.textContent = alert.read ? 'Read' : 'Unread';
    });
  }
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    saved = readStored();
    refresh();
    window.dispatchEvent(new Event('benefit-alerts-data'));
  });
  function syncPage() {
    saved = readStored();
    refresh();
    window.dispatchEvent(new Event('benefit-alerts-data'));
  }
  window.addEventListener('pageshow', syncPage);
  window.addEventListener('focus', syncPage);
  async function load() {
    try {
      if (window.BenefitData) {
        await window.BenefitData.ready;
        source = window.BenefitData.alertsData();
        refresh();
        return;
      }
      const response = await fetch('/api/alerts');
      if (!response.ok) throw new Error('Alerts unavailable');
      const data = await response.json();
      if (!Array.isArray(data?.alerts) || !Array.isArray(data?.past)
          || [...data.alerts, ...data.past].some(alert => !alert || alert.id == null)) {
        throw new Error('Invalid alerts');
      }
      source = {...DEMO, ...data};
    } catch { /* Shared demo feed until an alerts API is available. */ }
    refresh();
  }
  window.addEventListener('benefit-plan-changed', () => {
    if (!window.BenefitData) return;
    source = window.BenefitData.alertsData();
    refresh();
    window.dispatchEvent(new Event('benefit-alerts-data'));
  });
  window.BenefitNotifications = {getData, unread, markRead, clearPast, safeHref, ready: load()};
  refresh();
})();
