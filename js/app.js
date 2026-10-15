import * as db from './db.js';
import * as drive from './drive.js';
import { CONFIG } from './config.js';
import {
  uid, esc, money, moneyShort, toPaise, paiseToInput, fmtNum, todayISO, fmtDate, relDate,
  daysFromToday, monthLabel, debounce,
} from './util.js';

/* ---------- icons (inline stroke SVG) ---------- */
const P = {
  home: '<path d="M3 11 12 4l9 7v9H3z"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 20c1-4 4-6 7-6s6 2 7 6M17 11a3 3 0 1 0 0-6M22 20c-.5-2.5-2-4-4-4.5"/>',
  budget: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>',
  cloudOff: '<path d="M3 3l18 18M8.5 8.2A5 5 0 0 0 7 18h10M19.7 16.7A4 4 0 0 0 19 10a6 6 0 0 0-8.4-5.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  clip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
};
const icon = (n, size = 20, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;

/* ---------- state ---------- */
const S = { settings: null, stages: [], categories: [], vendors: [], milestones: [], expenses: [], attachments: [] };
const R = {}; // id -> record, including deleted (for names on old entries)
const ui = { filters: { q: '', stage: '', category: '', vendor: '', status: '' }, sync: 'local', syncMsg: '', formOpen: false, path: '/' };
let navCount = 0;

const MODES = ['UPI', 'Cash', 'Bank', 'Cheque', 'Card'];
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $('#view');

async function load() {
  for (const t of ['stages', 'categories', 'vendors', 'milestones', 'expenses', 'attachments']) {
    const rows = await db.all(t);
    R[t] = new Map(rows.map(r => [r.id, r]));
    S[t] = rows.filter(r => !r.deleted);
  }
  S.settings = (await db.get('settings', 'settings')) || { projectName: 'Our New Home', totalBudget: 0 };
  S.stages.sort((a, b) => a.order - b.order);
  S.categories.sort((a, b) => a.order - b.order);
  S.vendors.sort((a, b) => a.name.localeCompare(b.name));
  S.milestones.sort((a, b) => a.order - b.order);
  S.expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

const nameOf = (table, id, fallback = '') => (id && R[table]?.get(id)?.name) || fallback;
const attsOf = expenseId => S.attachments.filter(a => a.expenseId === expenseId);

function totals() {
  const add = (m, k, v) => { if (k) m[k] = (m[k] || 0) + v; };
  const t = { paid: 0, due: 0, stage: {}, stageDue: {}, stageCount: {}, cat: {}, vendor: {}, vendorDue: {}, ms: {} };
  const stageKey = e => (e.stageId && R.stages.get(e.stageId) && !R.stages.get(e.stageId).deleted ? e.stageId : '_none');
  for (const e of S.expenses) {
    add(t.stageCount, stageKey(e), 1);
    if (e.status === 'due') { t.due += e.amount; add(t.vendorDue, e.vendorId, e.amount); add(t.stageDue, stageKey(e), e.amount); continue; }
    t.paid += e.amount;
    add(t.stage, stageKey(e), e.amount);
    add(t.cat, e.categoryId || '_none', e.amount);
    add(t.vendor, e.vendorId, e.amount);
    add(t.ms, e.milestoneId, e.amount);
  }
  t.budget = S.settings.totalBudget || 0;
  return t;
}

const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

/* ---------- chrome: header, nav, sync pill, toast ---------- */
function setHeader(title, { eyebrow = '', back = '' } = {}) {
  document.title = title + ' · Home Build Tracker';
  $('#title').textContent = title;
  $('#eyebrow').textContent = eyebrow;
  $('#eyebrow').hidden = !eyebrow;
  const b = $('#back');
  b.hidden = !back;
  if (back) b.setAttribute('href', back);
  $('.topbar').classList.toggle('compact', !!back);
}

function setActiveNav(path) {
  const section = path.startsWith('/expense') || path === '/add' ? '/expenses'
    : path.startsWith('/vendor') ? '/vendors' : path;
  for (const a of $$('[data-nav]')) {
    const on = a.dataset.nav === section;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function renderPill() {
  const pill = $('#sync-pill');
  const dirty = drive.isDirty();
  const map = {
    local: ['warn', 'cloudOff', 'Not backed up'],
    auth: ['warn', 'refresh', dirty ? 'Unsynced · tap' : 'Tap to sync'],
    syncing: ['', 'refresh', 'Syncing…'],
    synced: ['ok', 'check', 'Synced'],
    offline: [dirty ? 'warn' : '', 'cloudOff', dirty ? 'Saved offline' : 'Offline'],
    error: ['warn', 'refresh', 'Sync failed · retry'],
  };
  const [tone, ic, label] = map[ui.sync] || map.local;
  pill.className = 'pill ' + tone + (ui.sync === 'syncing' ? ' spinning' : '');
  pill.innerHTML = icon(ic, 16) + `<span>${label}</span>`;
  pill.setAttribute('aria-label', 'Sync status: ' + label);
}

function setSync(state, msg = '') {
  ui.sync = state; ui.syncMsg = msg;
  renderPill();
  if (ui.path === '/settings' && !ui.formOpen) renderSettings();
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : '');
  el.classList.add('show');
  if (action) $('.toast-btn', el).onclick = () => { el.classList.remove('show'); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 10000 : 2600);
}

function goBack(fallback = '#/') {
  if (navCount > 1) history.back(); else location.hash = fallback;
}

/* ---------- shared row templates ---------- */
function expRow(e) {
  const cat = nameOf('categories', e.categoryId, 'Uncategorised');
  const bits = [e.vendorId ? nameOf('vendors', e.vendorId, 'Vendor') : cat];
  if (e.status === 'due') bits.push(e.dueDate ? 'due ' + relDate(e.dueDate) : 'due');
  else { if (e.mode) bits.push(e.mode); bits.push(relDate(e.date)); }
  const hasAtt = attsOf(e.id).length > 0;
  return `<div class="row-item exp-row">
    <a class="ri-link" href="#/expense/${e.id}">
      <div class="ri-main">
        <div class="ri-title">${esc(e.title || cat)}${hasAtt ? `<span class="ri-clip" title="Bill attached">${icon('clip', 14)}</span>` : ''}</div>
        <div class="ri-meta">${esc(bits.join(' · '))}</div>
      </div>
      <div class="ri-amt num${e.status === 'due' ? ' is-due' : ''}">${money(e.amount)}</div>
    </a>
    <button type="button" class="icon-btn ri-del" data-del-exp="${e.id}" aria-label="Delete ${esc(e.title || cat)}, ${money(e.amount)}">${icon('trash', 18)}</button>
  </div>`;
}

// Share of paid spend per stage: one 100% stacked bar + a legend with % and amount.
// Colours follow the stage (construction order), never its rank; more than 8 → "Other".
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER = '#8C918D';

function stageChart(t) {
  const rows = S.stages.map(s => ({ id: s.id, name: s.name }));
  if (t.stage._none || t.stageDue._none) rows.push({ id: '_none', name: 'No stage' });
  for (const r of rows) { r.v = t.stage[r.id] || 0; r.due = t.stageDue[r.id] || 0; r.n = t.stageCount[r.id] || 0; }
  let active = rows.filter(r => r.v > 0);
  if (!active.length) return emptyBox('Once you add paid expenses, this shows what share of the money went into each stage.');
  if (active.length > SERIES.length) {
    const keep = active.slice(0, SERIES.length - 1), rest = active.slice(SERIES.length - 1);
    active = [...keep, { id: '', name: `Other (${rest.length} stages)`, v: rest.reduce((s, r) => s + r.v, 0), due: rest.reduce((s, r) => s + r.due, 0), n: rest.reduce((s, r) => s + r.n, 0), other: true }];
  }
  active.forEach((r, i) => {
    r.color = r.other ? OTHER : SERIES[i];
    r.share = (r.v / t.paid) * 100;
    r.label = r.share >= 10 ? Math.round(r.share) + '%' : r.share >= 1 ? r.share.toFixed(1).replace(/\.0$/, '') + '%' : '<1%';
    r.tip = [`Paid ${money(r.v)}`, `${r.label} of spend`, `${r.n} ${r.n === 1 ? 'entry' : 'entries'}`, r.due ? `Due ${money(r.due)}` : ''].filter(Boolean).join(' · ');
  });
  const idle = S.stages.filter(s => !(t.stage[s.id] > 0)).length;
  const budgetLine = t.budget ? `<div class="sc-caption">${Math.round(pct(t.paid, t.budget))}% of your ${moneyShort(t.budget)} budget spent so far</div>` : '';
  return `${budgetLine}
    <div class="stack" role="img" aria-label="Share of spend by stage: ${esc(active.map(r => `${r.name} ${r.label}`).join(', '))}">
      ${active.map(r => `<span class="stack-seg sc-row" style="flex-grow:${r.v};background:${r.color}" data-name="${esc(r.name)}" data-tip="${esc(r.tip)}">${r.share >= 12 ? `<span class="stack-lbl">${r.label}</span>` : ''}</span>`).join('')}
    </div>
    <ul class="stack-legend">${active.map(r => `<li>
      <a class="sl-row sc-row" ${r.other ? '' : `href="#/expenses?stage=${r.id}"`} data-name="${esc(r.name)}" data-tip="${esc(r.tip)}">
        <span class="sl-sw" style="background:${r.color}" aria-hidden="true"></span>
        <span class="sl-name">${esc(r.name)}</span>
        <span class="sl-pct num">${r.label}</span>
        <span class="sl-amt num">${moneyShort(r.v)}</span>
      </a></li>`).join('')}</ul>
    ${idle > 0 ? `<div class="sc-foot">${idle} stage${idle === 1 ? '' : 's'} with no spend yet</div>` : ''}`;
}

function bindChartTips() {
  const tipEl = $('#chart-tip');
  if (!tipEl || !matchMedia('(hover: hover)').matches) return;
  for (const row of $$('.sc-row', view)) {
    row.addEventListener('pointerenter', () => {
      tipEl.innerHTML = `<strong>${esc(row.dataset.name)}</strong><span>${esc(row.dataset.tip)}</span>`;
      tipEl.hidden = false;
    });
    row.addEventListener('pointermove', ev => {
      const x = Math.min(ev.clientX + 14, innerWidth - tipEl.offsetWidth - 8);
      tipEl.style.transform = `translate(${x}px, ${ev.clientY + 16}px)`;
    });
    row.addEventListener('pointerleave', () => { tipEl.hidden = true; });
  }
}

async function deleteExpense(id) {
  await db.softDelete('expenses', id);
  for (const a of attsOf(id)) { await db.softDelete('attachments', a.id); await db.hardDelete('blobs', a.id); }
  await load();
}

const emptyBox = (text, link = '') => `<div class="empty">${text}${link}</div>`;

/* ---------- Home ---------- */
function renderHome() {
  const t = totals();
  setHeader(S.settings.projectName || 'Our New Home', { eyebrow: 'Project' });
  const paidPct = pct(t.paid, t.budget);
  const duePct = Math.min(100 - paidPct, pct(t.due, t.budget));
  const remaining = t.budget - t.paid - t.due;
  const dues = S.expenses.filter(e => e.status === 'due').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const cats = S.categories.map(c => ({ c, v: t.cat[c.id] || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (t.cat._none) cats.push({ c: { name: 'Uncategorised' }, v: t.cat._none });
  const maxCat = Math.max(1, ...cats.map(x => x.v));

  view.innerHTML = `<div class="home">
    <section class="hero">
      <div class="row between"><span class="hero-label">Spent so far</span>
        <a class="hero-label" href="#/budget">${t.budget ? 'Budget ' + money(t.budget) : 'Set budget'}</a></div>
      <div class="hero-amt num">${money(t.paid)}</div>
      <div class="bar bar-dark" role="img" aria-label="${Math.round(paidPct)}% of budget paid"><span class="paid" style="width:${paidPct}%"></span><span class="due" style="width:${duePct}%"></span></div>
      <div class="legend"><span><i class="sw sw-paid"></i>Paid ${Math.round(paidPct)}%</span>${t.due ? `<span><i class="sw sw-due"></i>Due ${money(t.due)}</span>` : ''}</div>
    </section>
    <section class="kpis">
      <div class="kpi"><div class="kpi-l">Total budget</div><div class="kpi-v num">${moneyShort(t.budget)}</div><div class="kpi-s">${t.budget ? 'Overall budget' : '<a href="#/budget">Set your budget</a>'}</div></div>
      <div class="kpi"><div class="kpi-l">Spent</div><div class="kpi-v num ok">${moneyShort(t.paid)}</div><div class="kpi-s">${t.budget ? Math.round(paidPct) + '% of budget' : `${S.expenses.length} entries`}</div></div>
      <div class="kpi"><div class="kpi-l">Due to vendors</div><div class="kpi-v num ${t.due ? 'warn' : ''}">${moneyShort(t.due)}</div><div class="kpi-s">${dues.length} pending</div></div>
      <div class="kpi"><div class="kpi-l">Remaining</div><div class="kpi-v num ${remaining < 0 ? 'warn' : ''}">${moneyShort(remaining)}</div><div class="kpi-s">after paying dues</div></div>
    </section>
    <section class="card stages-card">
      <div class="card-head"><h2>Spend by stage</h2>${t.paid ? `<span class="num muted">${money(t.paid)}</span>` : ''}</div>
      <div class="card-body">${stageChart(t)}</div>
    </section>
    <section class="card cats-card">
      <div class="card-head"><h2>By category</h2></div>
      <div class="card-body">${cats.length ? cats.map(({ c, v }) => `
        <div class="cat-row"><div class="row between"><span>${esc(c.name)}</span><span class="num">${moneyShort(v)}</span></div>
        <div class="bar thin"><span class="paid" style="width:${pct(v, maxCat)}%"></span></div></div>`).join('') : emptyBox('Spending by category shows here.')}</div>
    </section>
    <section class="card dues-card">
      <div class="card-head"><h2>Upcoming dues</h2>${dues.length ? `<span class="num muted">${money(t.due)}</span>` : ''}</div>
      <div class="card-body flush">${dues.length ? dues.slice(0, 6).map(e => {
        const d = e.dueDate ? daysFromToday(e.dueDate) : null;
        const when = d === null ? 'No due date' : d < 0 ? `Overdue · ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'Due today' : 'Due ' + relDate(e.dueDate);
        return `<div class="due-row">
          <a class="ri-main" href="#/expense/${e.id}"><div class="ri-title">${esc(e.title || nameOf('categories', e.categoryId, 'Payment'))}</div>
            <div class="ri-meta ${d !== null && d <= 0 ? 'overdue' : ''}">${esc(when)}${e.vendorId ? ' · ' + esc(nameOf('vendors', e.vendorId)) : ''}</div></a>
          <div class="due-side"><span class="num">${money(e.amount)}</span>
          <a class="btn-mini" href="#/expense/${e.id}?pay=1">Mark paid</a></div>
        </div>`;
      }).join('') : emptyBox('Nothing due. Save an entry as “Due later” to track money you owe.')}</div>
    </section>
    <section class="card recent-card">
      <div class="card-head"><h2>Recent</h2>${S.expenses.length ? '<a href="#/expenses">See all</a>' : ''}</div>
      <div class="card-body flush">${S.expenses.length ? S.expenses.slice(0, 6).map(expRow).join('') : emptyBox('No expenses yet.', ' <a href="#/add">Add one</a>')}</div>
    </section>
  </div>`;
  bindChartTips();
}

/* ---------- Expenses list ---------- */
function filteredExpenses() {
  const f = ui.filters, q = f.q.trim().toLowerCase();
  return S.expenses.filter(e =>
    (!f.stage || (f.stage === '_none' ? !(e.stageId && R.stages.get(e.stageId) && !R.stages.get(e.stageId).deleted) : e.stageId === f.stage)) &&
    (!f.category || e.categoryId === f.category) &&
    (!f.vendor || e.vendorId === f.vendor) &&
    (!f.status || e.status === f.status) &&
    (!q || [e.title, e.notes, nameOf('vendors', e.vendorId), nameOf('categories', e.categoryId)].join(' ').toLowerCase().includes(q)));
}

function renderExpenses(params) {
  setHeader('Expenses');
  if (params?.has('stage')) { ui.filters = { q: '', stage: params.get('stage'), category: '', vendor: '', status: '' }; history.replaceState(null, '', '#/expenses'); }
  const f = ui.filters;
  const opt = (arr, sel) => arr.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  view.innerHTML = `
    <form class="filters" id="filters" role="search" onsubmit="return false">
      <label class="search"><span class="sr-only">Search</span>${icon('search', 18)}
        <input type="search" name="q" placeholder="Search title, vendor, notes" value="${esc(f.q)}" autocomplete="off"></label>
      <div class="filter-selects">
        <label><span class="sr-only">Stage</span><select name="stage"><option value="">All stages</option>${opt(S.stages, f.stage)}<option value="_none"${f.stage === '_none' ? ' selected' : ''}>No stage</option></select></label>
        <label><span class="sr-only">Category</span><select name="category"><option value="">All categories</option>${opt(S.categories, f.category)}</select></label>
        <label><span class="sr-only">Vendor</span><select name="vendor"><option value="">All vendors</option>${opt(S.vendors, f.vendor)}</select></label>
        <label><span class="sr-only">Status</span><select name="status"><option value="">Paid & due</option>
          <option value="paid"${f.status === 'paid' ? ' selected' : ''}>Paid</option><option value="due"${f.status === 'due' ? ' selected' : ''}>Due</option></select></label>
      </div>
    </form>
    <div id="exp-results"></div>`;
  const form = $('#filters');
  const apply = () => {
    const fd = new FormData(form);
    for (const k of Object.keys(ui.filters)) ui.filters[k] = fd.get(k) || '';
    renderExpenseResults();
  };
  form.addEventListener('input', debounce(apply, 150));
  form.addEventListener('change', apply);
  renderExpenseResults();
}

function renderExpenseResults() {
  const list = filteredExpenses();
  const total = list.reduce((s, e) => s + e.amount, 0);
  const groups = new Map();
  for (const e of list) {
    const k = (e.date || todayISO()).slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const filtered = Object.values(ui.filters).some(Boolean);
  $('#exp-results').innerHTML = !S.expenses.length
    ? emptyBox('No expenses yet.', ' <a href="#/add">Add your first one</a>')
    : `<div class="summary-line"><span>${list.length} ${list.length === 1 ? 'entry' : 'entries'}${filtered ? ' match' : ''}</span><span class="num">${money(total)}</span></div>
      ${list.length ? [...groups].map(([k, rows]) => `
        <section class="card month">
          <div class="card-head"><h2>${monthLabel(k + '-01')}</h2><span class="num muted">${money(rows.reduce((s, e) => s + e.amount, 0))}</span></div>
          <div class="card-body flush">${rows.map(expRow).join('')}</div>
        </section>`).join('') : emptyBox('No entries match these filters.')}`;
}

/* ---------- Add / edit expense ---------- */
function msOptions(vendorId, selected) {
  const ms = S.milestones.filter(m => m.vendorId === vendorId);
  return ms.length ? `<option value="">— Not linked —</option>` + ms.map(m => `<option value="${m.id}"${m.id === selected ? ' selected' : ''}>${esc(m.name)} (${moneyShort(m.amount)})</option>`).join('') : '';
}

function renderExpenseForm(params, id) {
  const existing = id ? R.expenses.get(id) : null;
  if (id && (!existing || existing.deleted)) { toast('That entry no longer exists'); location.hash = '#/expenses'; return; }
  const payNow = params.get('pay') === '1';
  const e = existing ? { ...existing } : {
    status: 'paid', categoryId: S.categories[0]?.id || '', stageId: '', vendorId: params.get('vendor') || '',
    milestoneId: '', mode: 'UPI', date: todayISO(), dueDate: '', title: '', notes: '', amount: 0, qty: null, unit: '', rate: null,
  };
  if (payNow) { e.status = 'paid'; e.date = todayISO(); e.mode = e.mode || 'UPI'; }
  if (!e.stageId && !existing) e.stageId = localStorage.getItem('hbt.lastStage') || '';
  ui.formOpen = true;
  setHeader(existing ? (payNow ? 'Mark as paid' : 'Edit expense') : 'New expense', { back: existing ? '#/expenses' : '#/' });

  const removed = new Set();
  const pending = []; // { file, blob, url }

  view.innerHTML = `<form class="form" id="exp-form" data-status="${e.status}" novalidate>
    <div class="amount-block">
      <label for="f-amount" class="amount-label">Amount</label>
      <div class="amount-wrap"><span class="rupee" aria-hidden="true">₹</span>
        <input id="f-amount" name="amount" class="amount-input num" inputmode="decimal" autocomplete="off" placeholder="0" value="${paiseToInput(e.amount)}"></div>
      <div class="segmented" role="radiogroup" aria-label="Status">
        <label><input type="radio" name="status" value="paid"${e.status === 'paid' ? ' checked' : ''}><span>Paid</span></label>
        <label><input type="radio" name="status" value="due"${e.status === 'due' ? ' checked' : ''}><span>Due later</span></label>
      </div>
    </div>

    <div class="card form-card">
      <label class="field"><span>What was it for?</span>
        <input name="title" maxlength="120" placeholder="e.g. Cement – 50 bags" value="${esc(e.title)}"></label>
      <fieldset class="field"><legend>Category</legend>
        <div class="chips">${S.categories.map(c => `<label class="chip"><input type="radio" name="categoryId" value="${c.id}"${c.id === e.categoryId ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
      </fieldset>
    </div>

    <div class="card form-card rows">
      <label class="frow"><span>Stage</span>
        <select name="stageId"><option value="">— None —</option>${S.stages.map(s => `<option value="${s.id}"${s.id === e.stageId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="frow"><span>Vendor</span>
        <select name="vendorId" id="f-vendor"><option value="">— None —</option>${S.vendors.map(v => `<option value="${v.id}"${v.id === e.vendorId ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}<option value="__new">+ Add new vendor…</option></select></label>
      <label class="frow" id="new-vendor-row" hidden><span>New vendor</span><input name="newVendor" maxlength="80" placeholder="Name"></label>
      <label class="frow" id="ms-row"${msOptions(e.vendorId, e.milestoneId) ? '' : ' hidden'}><span>Milestone</span>
        <select name="milestoneId" id="f-ms">${msOptions(e.vendorId, e.milestoneId)}</select></label>
      <div class="frow qty-row"><span>Qty × rate</span>
        <div class="qty-inputs">
          <label><span class="sr-only">Quantity</span><input name="qty" inputmode="decimal" placeholder="Qty" value="${e.qty ?? ''}"></label>
          <label><span class="sr-only">Unit</span><input name="unit" maxlength="16" placeholder="bags" value="${esc(e.unit || '')}"></label>
          <span aria-hidden="true">×</span>
          <label><span class="sr-only">Rate in rupees</span><input name="rate" inputmode="decimal" placeholder="₹ rate" value="${paiseToInput(e.rate)}"></label>
        </div></div>
      <fieldset class="frow paid-only"><legend>Paid via</legend>
        <div class="chips small">${MODES.map(m => `<label class="chip"><input type="radio" name="mode" value="${m}"${m === e.mode ? ' checked' : ''}><span>${m}</span></label>`).join('')}</div>
      </fieldset>
      <label class="frow"><span class="paid-only">Date paid</span><span class="due-only">Entry date</span>
        <input type="date" name="date" value="${e.date || todayISO()}" required></label>
      <label class="frow due-only"><span>Due by</span><input type="date" name="dueDate" value="${e.dueDate || ''}"></label>
    </div>

    <div class="card form-card">
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Optional">${esc(e.notes || '')}</textarea></label>
      <div class="field"><span class="field-label">Bills &amp; receipts</span>
        <div class="atts" id="atts"></div>
        <div class="att-buttons">
          <label class="add-att camera-only">${icon('camera')}<span>Take photo</span>
            <input type="file" id="f-camera" accept="image/*" capture="environment" class="sr-only"></label>
          <label class="add-att">${icon('file')}<span>Upload photo or PDF</span>
            <input type="file" id="f-file" accept="image/*,application/pdf" multiple class="sr-only"></label>
        </div>
      </div>
    </div>

    <div class="form-actions">
      <button type="submit" class="btn primary">${payNow ? 'Save as paid' : 'Save expense'}</button>
      ${existing ? `<button type="button" class="btn danger" id="f-delete">${icon('trash', 18)} Delete</button>` : ''}
    </div>
  </form>`;

  const form = $('#exp-form');
  const amountEl = $('#f-amount');
  let amountTouched = !!e.amount;

  const renderAtts = () => {
    const saved = existing ? attsOf(existing.id).filter(a => !removed.has(a.id)) : [];
    $('#atts').innerHTML = saved.map(a => `
      <div class="att"><button type="button" class="att-thumb" data-view="${a.id}" aria-label="View ${esc(a.name || 'bill')}">
        ${a.type === 'application/pdf' ? `<span class="att-pdf">${icon('file', 22)}PDF</span>` : `<img alt="" data-att="${a.id}">`}</button>
        <button type="button" class="att-x" data-remove="${a.id}" aria-label="Remove bill">${icon('x', 14, 2.5)}</button></div>`).join('')
      + pending.map((p, i) => `
      <div class="att"><div class="att-thumb">${p.blob.type === 'application/pdf' ? `<span class="att-pdf">${icon('file', 22)}PDF</span>` : `<img alt="New bill" src="${p.url}">`}</div>
        <button type="button" class="att-x" data-pending="${i}" aria-label="Remove new bill">${icon('x', 14, 2.5)}</button></div>`).join('');
    for (const img of $$('img[data-att]', form)) {
      const a = R.attachments.get(img.dataset.att);
      drive.getBill(a).then(b => { if (b) img.src = URL.createObjectURL(b); else img.replaceWith(Object.assign(document.createElement('span'), { className: 'att-pdf', textContent: 'On Drive' })); });
    }
  };
  renderAtts();

  form.addEventListener('change', ev => {
    const t = ev.target;
    if (t.name === 'status') form.dataset.status = t.value;
    if (t.id === 'f-vendor') {
      $('#new-vendor-row').hidden = t.value !== '__new';
      if (t.value === '__new') $('[name=newVendor]', form).focus();
      const opts = msOptions(t.value, '');
      $('#f-ms').innerHTML = opts;
      $('#ms-row').hidden = !opts;
    }
  });
  const fitAmount = () => { amountEl.style.width = Math.max(2, amountEl.value.length + 1) + 'ch'; };
  fitAmount();
  amountEl.addEventListener('input', () => { amountTouched = amountEl.value.trim() !== ''; fitAmount(); });
  const autoAmount = () => {
    if (amountTouched) return;
    const qty = parseFloat($('[name=qty]', form).value), rate = parseFloat($('[name=rate]', form).value);
    if (qty > 0 && rate > 0) { amountEl.value = String(Math.round(qty * rate * 100) / 100); fitAmount(); }
  };
  $('[name=qty]', form).addEventListener('input', autoAmount);
  $('[name=rate]', form).addEventListener('input', autoAmount);

  const onFiles = async ev => {
    for (const file of ev.target.files) {
      if (file.size > 15 * 1024 * 1024) { toast(`${file.name} is over 15 MB — skipped`); continue; }
      const blob = await compressImage(file);
      pending.push({ file, blob, url: URL.createObjectURL(blob) });
    }
    ev.target.value = '';
    renderAtts();
  };
  $('#f-file').addEventListener('change', onFiles);
  $('#f-camera').addEventListener('change', onFiles);

  form.addEventListener('click', ev => {
    const v = ev.target.closest('[data-view]'), r = ev.target.closest('[data-remove]'), p = ev.target.closest('[data-pending]');
    if (v) openViewer(R.attachments.get(v.dataset.view));
    if (r) { removed.add(r.dataset.remove); renderAtts(); }
    if (p) { pending.splice(Number(p.dataset.pending), 1); renderAtts(); }
  });

  $('#f-delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this expense? Attached bills will be removed too.')) return;
    await deleteExpense(existing.id);
    ui.formOpen = false;
    toast('Expense deleted');
    goBack('#/expenses');
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const amount = toPaise(fd.get('amount'));
    if (!amount) { toast('Enter the amount'); amountEl.focus(); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      let vendorId = fd.get('vendorId') || '';
      if (vendorId === '__new') {
        const name = String(fd.get('newVendor') || '').trim();
        if (!name) { toast('Enter the new vendor’s name'); btn.disabled = false; return; }
        const v = await db.put('vendors', { id: uid(), name, trade: '', phone: '', agreed: 0, notes: '', createdAt: Date.now() });
        vendorId = v.id;
      }
      const status = fd.get('status') === 'due' ? 'due' : 'paid';
      const rec = existing ? { ...existing } : { id: uid(), createdAt: Date.now() };
      Object.assign(rec, {
        amount, status,
        title: String(fd.get('title') || '').trim(),
        categoryId: fd.get('categoryId') || '',
        stageId: fd.get('stageId') || '',
        vendorId,
        milestoneId: vendorId ? (fd.get('milestoneId') || '') : '',
        qty: parseFloat(fd.get('qty')) || null,
        unit: String(fd.get('unit') || '').trim(),
        rate: toPaise(fd.get('rate')) || null,
        mode: status === 'paid' ? (fd.get('mode') || '') : '',
        date: fd.get('date') || todayISO(),
        dueDate: status === 'due' ? (fd.get('dueDate') || '') : '',
        notes: String(fd.get('notes') || '').trim(),
      });
      await db.put('expenses', rec);
      if (rec.stageId) localStorage.setItem('hbt.lastStage', rec.stageId);
      for (const aid of removed) { await db.softDelete('attachments', aid); await db.hardDelete('blobs', aid); }
      for (const p of pending) {
        const a = { id: uid(), expenseId: rec.id, name: p.file.name, type: p.blob.type, size: p.blob.size, driveId: '', createdAt: Date.now() };
        await db.saveBlob(a.id, p.blob);
        await db.put('attachments', a);
        URL.revokeObjectURL(p.url);
      }
      await load();
      ui.formOpen = false;
      toast(existing ? 'Saved' : 'Expense added');
      goBack(existing ? '#/expenses' : '#/');
    } catch (err) {
      console.error(err);
      toast('Could not save — ' + err.message);
      btn.disabled = false;
    }
  });

  if (!existing) setTimeout(() => amountEl.focus(), 50);
}

async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

/* ---------- bill viewer ---------- */
async function openViewer(att) {
  if (!att) return;
  const v = $('#viewer');
  v.hidden = false;
  v.innerHTML = `<div class="viewer-bar"><span>${esc(att.name || 'Bill')}</span>
    <div class="row gap">${att.driveId ? `<a class="btn-mini light" href="https://drive.google.com/file/d/${encodeURIComponent(att.driveId)}/view" target="_blank" rel="noopener">Open in Drive</a>` : ''}
    <button type="button" class="icon-btn light" id="viewer-close" aria-label="Close">${icon('x', 22)}</button></div></div>
    <div class="viewer-body"><p class="muted-inv">Loading…</p></div>`;
  const close = () => { v.hidden = true; v.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('#viewer-close').onclick = close;
  $('#viewer-close').focus();
  const blob = await drive.getBill(att);
  const body = $('.viewer-body', v);
  if (!body) return;
  if (!blob) { body.innerHTML = `<p class="muted-inv">This bill is on Google Drive. Sync to view it on this device.</p>`; return; }
  const url = URL.createObjectURL(blob);
  body.innerHTML = blob.type === 'application/pdf'
    ? `<iframe src="${url}" title="Bill PDF"></iframe>`
    : `<img src="${url}" alt="Bill photo">`;
}

/* ---------- Vendors ---------- */
function vendorFigures(v, t) {
  const paid = t.vendor[v.id] || 0, due = t.vendorDue[v.id] || 0;
  return { paid, due, balance: v.agreed ? v.agreed - paid : null };
}

function renderVendors() {
  setHeader('Vendors');
  const t = totals();
  view.innerHTML = `<div class="toolbar"><a class="btn primary small" href="#/vendor/new">${icon('plus', 18)} Add vendor</a></div>
    ${S.vendors.length ? `<div class="vendor-grid">${S.vendors.map(v => {
      const f = vendorFigures(v, t);
      return `<a class="card vendor-card" href="#/vendor/${v.id}">
        <div class="row between"><div><div class="ri-title">${esc(v.name)}</div><div class="ri-meta">${esc(v.trade || 'Vendor')}</div></div>
          <div class="num vc-paid">${money(f.paid)}</div></div>
        ${v.agreed ? `<div class="bar thin"><span class="paid" style="width:${pct(f.paid, v.agreed)}%"></span></div>
          <div class="row between ri-meta"><span>Agreed ${moneyShort(v.agreed)}</span><span class="${f.balance < 0 ? 'overdue' : ''}">${f.balance < 0 ? 'Overpaid ' + moneyShort(-f.balance) : 'Balance ' + moneyShort(f.balance)}</span></div>` : ''}
        ${f.due ? `<div class="ri-meta overdue">Due ${money(f.due)}</div>` : ''}
      </a>`;
    }).join('')}</div>` : emptyBox('Add contractors and suppliers to track what you’ve agreed, paid and still owe.')}`;
}

function renderVendor(params, id) {
  const v = R.vendors.get(id);
  if (!v || v.deleted) { location.hash = '#/vendors'; return; }
  setHeader(v.name, { eyebrow: v.trade || 'Vendor', back: '#/vendors' });
  const t = totals(), f = vendorFigures(v, t);
  const ms = S.milestones.filter(m => m.vendorId === id);
  const txns = S.expenses.filter(e => e.vendorId === id);
  view.innerHTML = `<div class="vendor-page">
    <section class="card vendor-summary">
      <div class="vs-grid">
        <div><div class="kpi-l">Agreed</div><div class="kpi-v num">${v.agreed ? moneyShort(v.agreed) : '—'}</div></div>
        <div><div class="kpi-l">Paid</div><div class="kpi-v num ok">${moneyShort(f.paid)}</div></div>
        <div><div class="kpi-l">${f.balance !== null && f.balance < 0 ? 'Overpaid' : 'Balance'}</div><div class="kpi-v num ${f.balance ? 'warn' : ''}">${f.balance === null ? '—' : moneyShort(Math.abs(f.balance))}</div></div>
      </div>
      ${v.agreed ? `<div class="bar"><span class="paid" style="width:${pct(f.paid, v.agreed)}%"></span></div>` : ''}
      ${f.due ? `<div class="ri-meta overdue">Also ${money(f.due)} recorded as due</div>` : ''}
      <div class="row gap wrap vs-actions">
        <a class="btn primary small" href="#/add?vendor=${v.id}">${icon('plus', 18)} Add payment</a>
        <a class="btn small" href="#/vendor/${v.id}/edit">${icon('edit', 18)} Edit</a>
        ${v.phone ? `<a class="btn small" href="tel:${esc(v.phone.replace(/[^0-9+]/g, ''))}">${icon('phone', 18)} Call</a>` : ''}
      </div>
      ${v.notes ? `<p class="notes">${esc(v.notes)}</p>` : ''}
    </section>
    ${ms.length ? `<section class="card">
      <div class="card-head"><h2>Payment milestones</h2></div>
      <div class="card-body flush">${ms.map(m => {
        const paid = t.ms[m.id] || 0, done = paid >= m.amount;
        const meta = done ? 'Paid in full' : paid ? `Paid ${money(paid)} of ${money(m.amount)}` : 'Not paid yet';
        return `<div class="ms-row"><span class="ms-dot${done ? ' done' : paid ? ' part' : ''}" aria-hidden="true">${done ? icon('check', 12, 3.5) : ''}</span>
          <div class="ri-main"><div class="ri-title">${esc(m.name)}</div><div class="ri-meta">${meta}</div></div>
          <div class="num">${money(m.amount)}</div></div>`;
      }).join('')}</div></section>` : ''}
    <section class="card">
      <div class="card-head"><h2>Transactions</h2>${txns.length ? `<span class="num muted">${txns.length}</span>` : ''}</div>
      <div class="card-body flush">${txns.length ? txns.map(expRow).join('') : emptyBox('No payments recorded for this vendor yet.')}</div>
    </section>
  </div>`;
}

function renderVendorForm(params, id) {
  const existing = id ? R.vendors.get(id) : null;
  if (id && (!existing || existing.deleted)) { location.hash = '#/vendors'; return; }
  const v = existing ? { ...existing } : { name: '', trade: '', phone: '', agreed: 0, notes: '' };
  ui.formOpen = true;
  setHeader(existing ? 'Edit vendor' : 'New vendor', { back: existing ? `#/vendor/${id}` : '#/vendors' });
  const ms = existing ? S.milestones.filter(m => m.vendorId === id) : [];
  const msRow = (m = {}) => `<div class="ms-edit" data-id="${m.id || ''}">
    <label><span class="sr-only">Milestone name</span><input name="msName" maxlength="80" placeholder="e.g. Roof slab cast" value="${esc(m.name || '')}"></label>
    <label><span class="sr-only">Amount in rupees</span><input name="msAmount" inputmode="decimal" placeholder="₹ amount" value="${paiseToInput(m.amount)}"></label>
    <button type="button" class="icon-btn" data-ms-remove aria-label="Remove milestone">${icon('x', 18)}</button></div>`;

  view.innerHTML = `<form class="form" id="vendor-form" novalidate>
    <div class="card form-card">
      <label class="field"><span>Name</span><input name="name" required maxlength="80" value="${esc(v.name)}" placeholder="e.g. Joseph & Sons Masonry"></label>
      <label class="field"><span>Trade / supplies</span><input name="trade" maxlength="60" value="${esc(v.trade)}" placeholder="e.g. Mason contractor, Cement supplier"></label>
      <label class="field"><span>Phone</span><input name="phone" type="tel" maxlength="20" value="${esc(v.phone)}" placeholder="Optional"></label>
      <label class="field"><span>Agreed contract amount</span><input name="agreed" inputmode="decimal" value="${paiseToInput(v.agreed)}" placeholder="Optional — for contractors">
        <small>Leave blank for shops you pay per bill.</small></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Scope, terms, bank details…">${esc(v.notes)}</textarea></label>
    </div>
    <div class="card form-card">
      <div class="field"><span class="field-label">Payment milestones</span>
        <small>Optional. Link payments to a milestone when you add them.</small>
        <div id="ms-list">${ms.map(msRow).join('')}</div>
        <button type="button" class="btn small" id="ms-add">${icon('plus', 18)} Add milestone</button>
      </div>
    </div>
    <div class="form-actions">
      <button type="submit" class="btn primary">Save vendor</button>
      ${existing ? `<button type="button" class="btn danger" id="v-delete">${icon('trash', 18)} Delete</button>` : ''}
    </div>
  </form>`;
  const form = $('#vendor-form');
  const removedMs = new Set();
  $('#ms-add').onclick = () => { $('#ms-list').insertAdjacentHTML('beforeend', msRow()); $('#ms-list .ms-edit:last-child input').focus(); };
  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-ms-remove]');
    if (!b) return;
    const row = b.closest('.ms-edit');
    if (row.dataset.id) removedMs.add(row.dataset.id);
    row.remove();
  });
  $('#v-delete')?.addEventListener('click', async () => {
    const n = S.expenses.filter(e => e.vendorId === id).length;
    if (!confirm(n ? `Delete this vendor? Its ${n} expense${n > 1 ? 's' : ''} will stay, without a vendor.` : 'Delete this vendor?')) return;
    await db.softDelete('vendors', id);
    for (const m of ms) await db.softDelete('milestones', m.id);
    await load();
    ui.formOpen = false;
    location.hash = '#/vendors';
  });
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Enter a name'); $('[name=name]', form).focus(); return; }
    const rec = existing ? { ...existing } : { id: uid(), createdAt: Date.now() };
    Object.assign(rec, { name, trade: String(fd.get('trade') || '').trim(), phone: String(fd.get('phone') || '').trim(), agreed: toPaise(fd.get('agreed')), notes: String(fd.get('notes') || '').trim() });
    await db.put('vendors', rec);
    let order = 0;
    for (const row of $$('.ms-edit', form)) {
      const mName = $('[name=msName]', row).value.trim(), amt = toPaise($('[name=msAmount]', row).value);
      if (!mName && !amt) { if (row.dataset.id) removedMs.add(row.dataset.id); continue; }
      const m = row.dataset.id ? { ...R.milestones.get(row.dataset.id) } : { id: uid(), vendorId: rec.id, createdAt: Date.now() };
      Object.assign(m, { name: mName || 'Milestone', amount: amt, order: order++ });
      await db.put('milestones', m);
    }
    for (const mid of removedMs) await db.softDelete('milestones', mid);
    await load();
    ui.formOpen = false;
    toast('Vendor saved');
    location.hash = `#/vendor/${rec.id}`;
  });
  if (!existing) setTimeout(() => $('[name=name]', form).focus(), 50);
}

/* ---------- Budget: total, stages, categories ---------- */
function renderBudget() {
  setHeader('Budget & stages');
  const t = totals();
  const usage = (field, id) => S.expenses.filter(e => e[field] === id).length;
  view.innerHTML = `<div class="budget-page">
    <section class="card form-card">
      <label class="field"><span>Total budget</span>
        <input data-act="total-budget" inputmode="decimal" placeholder="e.g. 4500000" value="${paiseToInput(S.settings.totalBudget)}">
        <small>${t.budget ? `Spent ${money(t.paid)} so far (${Math.round(pct(t.paid, t.budget))}%).` : 'Your overall budget for the whole build, in rupees.'}</small></label>
    </section>
    <section class="card">
      <div class="card-head"><h2>Stages</h2></div>
      <div class="card-body">
        ${S.stages.map((s, i) => `<div class="edit-row">
          <div class="er-reorder">
            <button type="button" class="icon-btn" data-act="stage-move" data-id="${s.id}" data-dir="-1" aria-label="Move ${esc(s.name)} up"${i === 0 ? ' disabled' : ''}>${icon('up', 18)}</button>
            <button type="button" class="icon-btn" data-act="stage-move" data-id="${s.id}" data-dir="1" aria-label="Move ${esc(s.name)} down"${i === S.stages.length - 1 ? ' disabled' : ''}>${icon('down', 18)}</button>
          </div>
          <div class="er-main">
            <label><span class="sr-only">Stage name</span><input data-act="stage-name" data-id="${s.id}" value="${esc(s.name)}" maxlength="60"></label>
            <div class="ri-meta">Spent ${money(t.stage[s.id] || 0)} · ${usage('stageId', s.id)} entries</div>
          </div>
          <button type="button" class="icon-btn" data-act="stage-del" data-id="${s.id}" data-n="${usage('stageId', s.id)}" aria-label="Delete ${esc(s.name)}">${icon('trash', 18)}</button>
        </div>`).join('')}
        <form class="add-row" data-act="stage-add"><label><span class="sr-only">New stage name</span><input name="name" placeholder="Add a stage" maxlength="60"></label><button class="btn small" type="submit">${icon('plus', 18)} Add</button></form>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Categories</h2></div>
      <div class="card-body">
        ${S.categories.map(c => `<div class="edit-row">
          <div class="er-main"><label><span class="sr-only">Category name</span><input data-act="cat-name" data-id="${c.id}" value="${esc(c.name)}" maxlength="40"></label>
            <div class="ri-meta">${usage('categoryId', c.id)} entries · ${money(t.cat[c.id] || 0)}</div></div>
          <button type="button" class="icon-btn" data-act="cat-del" data-id="${c.id}" data-n="${usage('categoryId', c.id)}" aria-label="Delete ${esc(c.name)}">${icon('trash', 18)}</button>
        </div>`).join('')}
        <form class="add-row" data-act="cat-add"><label><span class="sr-only">New category name</span><input name="name" placeholder="Add a category" maxlength="40"></label><button class="btn small" type="submit">${icon('plus', 18)} Add</button></form>
      </div>
    </section>
  </div>`;
}

async function saveSettings(patch) {
  const s = (await db.get('settings', 'settings')) || { id: 'settings' };
  Object.assign(s, patch);
  await db.put('settings', s);
  await load();
}

const budgetActions = {
  async 'total-budget'(el) { await saveSettings({ totalBudget: toPaise(el.value) }); renderBudget(); },
  async 'stage-name'(el) { const s = R.stages.get(el.dataset.id); const n = el.value.trim(); if (!n) { el.value = s.name; return; } await db.put('stages', { ...s, name: n }); await load(); },
  async 'cat-name'(el) { const c = R.categories.get(el.dataset.id); const n = el.value.trim(); if (!n) { el.value = c.name; return; } await db.put('categories', { ...c, name: n }); await load(); },
  async 'stage-move'(el) {
    const i = S.stages.findIndex(s => s.id === el.dataset.id), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= S.stages.length) return;
    const arr = [...S.stages];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    for (let k = 0; k < arr.length; k++) if (arr[k].order !== k) await db.put('stages', { ...arr[k], order: k });
    await load(); renderBudget();
    $(`[data-act="stage-move"][data-id="${el.dataset.id}"][data-dir="${el.dataset.dir}"]`)?.focus();
  },
  async 'stage-del'(el) {
    const n = Number(el.dataset.n);
    if (!confirm(n ? `Delete this stage? ${n} expense${n > 1 ? 's' : ''} will show as “No stage”.` : 'Delete this stage?')) return;
    await db.softDelete('stages', el.dataset.id); await load(); renderBudget();
  },
  async 'cat-del'(el) {
    const n = Number(el.dataset.n);
    if (!confirm(n ? `Delete this category? ${n} expense${n > 1 ? 's' : ''} will show as “Uncategorised”.` : 'Delete this category?')) return;
    await db.softDelete('categories', el.dataset.id); await load(); renderBudget();
  },
  async 'stage-add'(form) {
    const name = form.name.value.trim(); if (!name) return;
    await db.put('stages', { id: uid(), name, budget: 0, order: S.stages.length }); await load(); renderBudget();
    $('[data-act="stage-add"] input')?.focus();
  },
  async 'cat-add'(form) {
    const name = form.name.value.trim(); if (!name) return;
    await db.put('categories', { id: uid(), name, order: S.categories.length }); await load(); renderBudget();
    $('[data-act="cat-add"] input')?.focus();
  },
};

/* ---------- Settings ---------- */
function renderSettings() {
  setHeader('Settings');
  const connected = drive.isConnected();
  const last = drive.lastSyncAt();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let driveBody;
  if (!drive.isConfigured()) {
    driveBody = `<p class="warn-box">Google sign-in isn’t set up yet. Add your OAuth Client ID to <code>js/config.js</code> — see the README.</p>`;
  } else if (!connected) {
    driveBody = `<p>Back up your entries and bills to your own Google Drive, and see the same data on your phone and desktop. The app can only see files it creates.</p>
      <button type="button" class="btn primary" data-act="connect">${icon('cloud', 18)} Connect Google Drive</button>`;
  } else {
    const status = { synced: 'Up to date', syncing: 'Syncing…', auth: 'Sign-in expired — reconnect to sync', offline: 'Offline — will sync when back online', error: 'Last sync failed' + (ui.syncMsg ? ` (${esc(ui.syncMsg)})` : '') }[ui.sync] || '';
    driveBody = `<dl class="kv">
        <div><dt>Account</dt><dd>${esc(drive.account() || 'Connected')}</dd></div>
        <div><dt>Status</dt><dd>${status}</dd></div>
        <div><dt>Last synced</dt><dd>${last ? new Date(last).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}</dd></div>
        <div><dt>Location</dt><dd>My Drive › ${esc(CONFIG.DRIVE_FOLDER_NAME)}</dd></div>
      </dl>
      <div class="row gap wrap">
        ${drive.tokenValid() ? `<button type="button" class="btn primary small" data-act="sync-now">${icon('refresh', 18)} Sync now</button>`
          : `<button type="button" class="btn primary small" data-act="reconnect">${icon('refresh', 18)} Reconnect</button>`}
        <button type="button" class="btn small" data-act="disconnect">Disconnect</button>
      </div>`;
  }
  const steps = [
    [!!S.settings.totalBudget, '#/budget', 'Set your overall budget'],
    [S.expenses.length > 0, '#/add', 'Add your first expense'],
    [connected, '', 'Connect Google Drive so your data is backed up and shows on your desktop'],
    [!!standalone, 'scroll', 'Install the app on your home screen'],
  ];
  const doneCount = steps.filter(s => s[0]).length;
  const welcome = doneCount === steps.length ? '' : `<section class="card form-card welcome">
      <div class="row between"><h2 class="section-title">Welcome! Let’s set up your build</h2><span class="muted nowrap">${doneCount} of ${steps.length} done</span></div>
      <ol class="checklist">${steps.map(([done, href, label]) => `<li class="${done ? 'done' : ''}">
        <span class="ck" aria-hidden="true">${done ? icon('check', 14, 3) : ''}</span>
        ${done ? `<span>${label}</span><span class="sr-only">(done)</span>`
          : href === 'scroll' ? `<button type="button" class="linkish" data-act="scroll-install">${label}</button>`
          : href ? `<a href="${href}">${label}</a>`
          : drive.isConfigured() ? `<button type="button" class="linkish" data-act="connect">${label}</button>` : `<span>${label}</span>`}
      </li>`).join('')}</ol>
    </section>`;
  view.innerHTML = `<div class="settings-page">
    ${welcome}
    <a class="card settings-link" href="#/budget">
      <span class="sl-icon" aria-hidden="true">${icon('budget', 20)}</span>
      <span class="sl-main"><span class="sl-title">Budget &amp; stages</span>
        <span class="ri-meta">${S.settings.totalBudget ? 'Budget ' + money(S.settings.totalBudget) : 'Set your overall budget'} · ${S.stages.length} stages · categories</span></span>
      <span aria-hidden="true" class="sl-chev">›</span>
    </a>
    <section class="card form-card">
      <label class="field"><span>Project name</span><input data-act="project-name" maxlength="60" value="${esc(S.settings.projectName || '')}"></label>
    </section>
    <section class="card form-card">
      <h2 class="section-title">Google Drive backup &amp; sync</h2>
      ${driveBody}
    </section>
    ${!standalone ? `<section class="card form-card" id="install">
      <h2 class="section-title">Install the app</h2>
      ${ios ? `<p>In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. Use it from the home screen icon — iPhone keeps an installed app’s data safe, but may clear a website’s storage after a few weeks unused.</p>`
        : `<p>In Chrome or Edge, use the install icon in the address bar (or menu › <strong>Install app</strong>) to open it in its own window.</p>`}
    </section>` : ''}
    <section class="card form-card">
      <h2 class="section-title">About</h2>
      <p class="muted">Home Build Tracker v${CONFIG.APP_VERSION}. Data is stored on this device${connected ? ' and in your Google Drive' : ''}.
      ${S.expenses.length} expenses · ${S.vendors.length} vendors · ${S.attachments.length} bills.</p>
    </section>
  </div>`;
}

const settingsActions = {
  async 'project-name'(el) { const n = el.value.trim(); if (!n) return; await saveSettings({ projectName: n }); setHeader('Settings'); },
  connect() { drive.signIn(); },
  'scroll-install'() { $('#install')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  reconnect() { drive.signIn({ silent: true }); },
  'sync-now'() { doSync(); },
  async disconnect() {
    if (!confirm('Disconnect Google Drive? Your data stays on this device and in Drive; this device just stops syncing.')) return;
    await drive.disconnect(); setSync('local');
  },
};

/* ---------- delegation for budget/settings controls ---------- */
const actions = { ...budgetActions, ...settingsActions };
view.addEventListener('change', ev => {
  const el = ev.target.closest('[data-act]');
  if (el && el.tagName !== 'FORM' && el.tagName !== 'BUTTON' && actions[el.dataset.act]) actions[el.dataset.act](el);
});
view.addEventListener('click', async ev => {
  const del = ev.target.closest('[data-del-exp]');
  if (del) {
    ev.preventDefault();
    const e = R.expenses.get(del.dataset.delExp);
    if (!e || !confirm(`Delete “${e.title || nameOf('categories', e.categoryId, 'this expense')}” (${money(e.amount)})?` + (attsOf(e.id).length ? ' Its bills will be removed too.' : ''))) return;
    await deleteExpense(e.id);
    toast('Expense deleted');
    if (ui.path === '/expenses') renderExpenseResults(); else route();
    return;
  }
  const el = ev.target.closest('button[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
view.addEventListener('submit', ev => {
  const f = ev.target.closest('form[data-act]');
  if (f && actions[f.dataset.act]) { ev.preventDefault(); actions[f.dataset.act](f); }
});
view.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.matches('input[data-act]')) ev.target.blur();
});

/* ---------- router ---------- */
const routes = [
  [/^\/$/, renderHome],
  [/^\/expenses$/, renderExpenses],
  [/^\/add$/, p => renderExpenseForm(p, null)],
  [/^\/expense\/([\w-]+)$/, (p, id) => renderExpenseForm(p, id)],
  [/^\/vendors$/, renderVendors],
  [/^\/vendor\/new$/, p => renderVendorForm(p, null)],
  [/^\/vendor\/([\w-]+)\/edit$/, (p, id) => renderVendorForm(p, id)],
  [/^\/vendor\/([\w-]+)$/, (p, id) => renderVendor(p, id)],
  [/^\/budget$/, renderBudget],
  [/^\/settings$/, renderSettings],
];

function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  ui.formOpen = false;
  ui.applyUpdate?.();
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      ui.path = path;
      fn(new URLSearchParams(qs || ''), ...m.slice(1));
      setActiveNav(path);
      window.scrollTo(0, 0);
      $('#view').focus({ preventScroll: true });
      return;
    }
  }
  location.replace('#/');
}

/* ---------- sync orchestration ---------- */
async function doSync() {
  if (!drive.isConfigured() || !drive.isConnected()) return setSync('local');
  await drive.sync({
    onStatus: setSync,
    onRemoteChange: async () => { await load(); if (!ui.formOpen) route(); },
  });
}
const scheduleSync = debounce(doSync, 2500);

function onPill() {
  if (!drive.isConfigured() || !drive.isConnected()) { location.hash = '#/settings'; return; }
  if (ui.sync === 'auth') { drive.signIn({ silent: true }); return; }
  doSync();
}

/* ---------- service worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // A new deployment installs a new service worker in the background. We switch to it
  // straight away and reload — except while a form is open, so a half-typed entry is
  // never lost; then it applies as soon as you leave the form.
  let waiting = null;
  ui.applyUpdate = () => {
    if (waiting && !ui.formOpen) { waiting.postMessage('skipWaiting'); waiting = null; }
  };
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const found = w => { waiting = w; ui.applyUpdate(); };
    if (reg.waiting && navigator.serviceWorker.controller) found(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) found(w); });
    });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 15 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // first install isn't an update
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    sessionStorage.setItem('hbt.updated', '1');
    location.reload();
  });
}

/* ---------- start ---------- */
async function init() {
  if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) document.documentElement.classList.add('touch');
  const auth = drive.handleRedirect();
  await db.seed();
  await load();
  navigator.storage?.persist?.().catch(() => {});

  $('#sync-pill').addEventListener('click', onPill);
  window.addEventListener('hashchange', () => { navCount++; route(); });
  window.addEventListener('hbt:changed', () => { if (drive.isConnected()) scheduleSync(); else renderPill(); });
  window.addEventListener('online', doSync);
  window.addEventListener('offline', () => setSync(drive.isConnected() ? 'offline' : 'local'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') doSync(); });

  navCount = 1;
  route();

  if (sessionStorage.getItem('hbt.updated')) { sessionStorage.removeItem('hbt.updated'); toast('Updated to the latest version'); }
  if (auth?.ok) { toast('Connected to Google Drive'); }
  else if (auth?.error) {
    if (auth.wasSilent && /interaction_required|login_required|consent_required|account_selection_required/.test(auth.error)) { drive.signIn(); return; }
    toast(auth.error === 'access_denied' ? 'Google sign-in was cancelled' : 'Google sign-in failed (' + auth.error + ')');
  }
  setSync(drive.isConnected() ? (drive.tokenValid() ? 'synced' : 'auth') : 'local');
  doSync();
  registerSW();
}

init();
