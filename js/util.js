export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

// Amounts are stored as integer paise.
export const money = paise => (paise < 0 ? '-₹' : '₹') + inr.format(Math.abs(Math.round((paise || 0) / 100)));

export function moneyShort(paise) {
  const r = (paise || 0) / 100, a = Math.abs(r), sign = r < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${Number((a / 1e7).toFixed(2))}Cr`;
  if (a >= 1e5) return `${sign}₹${Number((a / 1e5).toFixed(a >= 1e6 ? 1 : 2))}L`;
  return money(paise);
}

export const toPaise = v => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const paiseToInput = p => (p ? inr2.format(p / 100).replace(/,/g, '') : '');
export const fmtNum = n => inr2.format(n || 0);

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const asDate = iso => new Date(iso + 'T00:00:00');

export const fmtDate = iso => (iso ? asDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function relDate(iso) {
  if (!iso) return '';
  const days = Math.round((asDate(iso) - asDate(todayISO())) / 864e5);
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  if (days === 1) return 'tomorrow';
  const d = asDate(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-IN', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export const daysFromToday = iso => Math.round((asDate(iso) - asDate(todayISO())) / 864e5);

export const monthLabel = iso => asDate(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Indian-style amount in words for big numbers: "45 lakhs", "1.2 crore", "75 thousand".
export function amountInWords(paise) {
  const r = Math.round((paise || 0) / 100);
  if (r <= 0) return '';
  const trim = (n, d) => String(Number(n.toFixed(d)));
  if (r >= 1e7) return `${trim(r / 1e7, 2)} crore`;
  if (r >= 1e5) { const v = trim(r / 1e5, 2); return `${v} ${v === '1' ? 'lakh' : 'lakhs'}`; }
  if (r >= 1e3) return `${trim(r / 1e3, 1)} thousand`;
  return `${r} rupees`;
}
