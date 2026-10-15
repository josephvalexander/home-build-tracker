// Google Drive sync using the OAuth 2.0 redirect (implicit) flow.
// Redirect instead of a popup because popups are unreliable in an installed iPhone PWA.
import { CONFIG } from './config.js';
import * as db from './db.js';
import { uid } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const K = k => 'hbt.' + k;
const ls = {
  get: k => localStorage.getItem(K(k)),
  set: (k, v) => localStorage.setItem(K(k), String(v)),
  del: k => localStorage.removeItem(K(k)),
};

export class AuthError extends Error {}

export const isConfigured = () => !CONFIG.GOOGLE_CLIENT_ID.startsWith('PASTE_');
export const isConnected = () => ls.get('connected') === '1';
export const tokenValid = () => !!ls.get('token') && Date.now() < Number(ls.get('tokenExp') || 0);
export const isDirty = () => Number(ls.get('dirtyAt') || 0) > Number(ls.get('lastSyncAt') || 0);
export const lastSyncAt = () => Number(ls.get('lastSyncAt') || 0);
export const account = () => ls.get('email') || '';

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// Call once at startup, before routing. Returns null, {ok:true} or {error, wasSilent}.
export function handleRedirect() {
  const h = location.hash;
  if (!/(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h.slice(1));
  const expected = ls.get('oauthState');
  const wasSilent = ls.get('oauthSilent') === '1';
  ls.del('oauthState'); ls.del('oauthSilent');
  history.replaceState(null, '', redirectUri() + '#/');
  if (!expected || p.get('state') !== expected) return { error: 'state_mismatch', wasSilent };
  if (p.get('error')) return { error: p.get('error'), wasSilent };
  ls.set('token', p.get('access_token'));
  ls.set('tokenExp', Date.now() + (Number(p.get('expires_in') || 3600) - 120) * 1000);
  ls.set('connected', '1');
  return { ok: true };
}

export function signIn({ silent = false } = {}) {
  const state = uid();
  ls.set('oauthState', state);
  ls.set('oauthSilent', silent ? '1' : '0');
  const params = new URLSearchParams({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  const email = account();
  if (email) params.set('login_hint', email);
  if (silent && email) params.set('prompt', 'none');
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

export async function disconnect() {
  const t = ls.get('token');
  if (t) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch { /* offline is fine */ } }
  for (const k of ['token', 'tokenExp', 'connected', 'email', 'lastSyncAt']) ls.del(k);
}

async function api(url, opts = {}) {
  if (!tokenValid()) throw new AuthError('Sign-in expired');
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + ls.get('token') } });
  if (res.status === 401) { ls.del('token'); throw new AuthError('Sign-in expired'); }
  if (!res.ok) throw new Error(`Drive error ${res.status}`);
  return res;
}

const q = s => encodeURIComponent(s);

async function findOne(query) {
  const r = await api(`${API}/files?q=${q(query + ' and trashed=false')}&fields=files(id)&pageSize=1&spaces=drive`);
  return (await r.json()).files?.[0]?.id || null;
}

async function ensureFolder(name, parent) {
  const where = `name='${name}' and mimeType='application/vnd.google-apps.folder'` + (parent ? ` and '${parent}' in parents` : '');
  const found = await findOne(where);
  if (found) return found;
  const r = await api(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
  });
  return (await r.json()).id;
}

function multipart(meta, blob) {
  const b = 'hbt' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${b}--`,
  ]);
  return { body, type: `multipart/related; boundary=${b}` };
}

async function createFile(meta, blob) {
  const m = multipart(meta, blob);
  const r = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body });
  return (await r.json()).id;
}

async function mergeRemote(remote) {
  let changed = false;
  for (const table of db.SYNC_TABLES) {
    const incoming = remote[table];
    if (!Array.isArray(incoming) || !incoming.length) continue;
    const local = new Map((await db.all(table)).map(r => [r.id, r]));
    const winners = incoming.filter(r => r && r.id && (!local.has(r.id) || (r.updatedAt || 0) > (local.get(r.id).updatedAt || 0)));
    if (winners.length) { await db.putRaw(table, winners); changed = true; }
  }
  return changed;
}

async function buildPayload() {
  const out = { schema: 1, exportedAt: Date.now(), app: 'home-build-tracker' };
  for (const t of db.SYNC_TABLES) out[t] = await db.all(t);
  return out;
}

const ext = type => (type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg');

async function uploadBills(folderId) {
  const atts = (await db.all('attachments')).filter(a => !a.deleted && !a.driveId);
  for (const a of atts) {
    const blob = await db.loadBlob(a.id);
    if (!blob) continue;
    a.driveId = await createFile({ name: `bill_${a.id.slice(0, 8)}.${ext(blob.type)}`, parents: [folderId] }, blob);
    await db.put('attachments', a, { silent: true });
  }
}

async function trashDeletedBills() {
  const atts = (await db.all('attachments')).filter(a => a.deleted && a.driveId && !a.driveTrashed);
  for (const a of atts) {
    try {
      await api(`${API}/files/${a.driveId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    } catch (e) { if (e instanceof AuthError) throw e; }
    a.driveTrashed = true;
    await db.put('attachments', a, { silent: true });
  }
}

let running = null;

// onStatus(state, message): 'syncing' | 'synced' | 'auth' | 'offline' | 'error'
export function sync({ onStatus = () => {}, onRemoteChange = () => {} } = {}) {
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) return onStatus('offline');
    if (!tokenValid()) return onStatus('auth');
    onStatus('syncing');
    const started = Date.now();
    try {
      const folder = await ensureFolder(CONFIG.DRIVE_FOLDER_NAME);
      const bills = await ensureFolder('bills', folder);
      const fileId = await findOne(`name='data.json' and '${folder}' in parents`);
      if (fileId) {
        const remote = await (await api(`${API}/files/${fileId}?alt=media`)).json();
        if (await mergeRemote(remote)) await onRemoteChange();
      }
      await uploadBills(bills);
      await trashDeletedBills();
      const payload = new Blob([JSON.stringify(await buildPayload())], { type: 'application/json' });
      if (fileId) {
        await api(`${UPLOAD}/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: payload });
      } else {
        await createFile({ name: 'data.json', parents: [folder], mimeType: 'application/json' }, payload);
      }
      if (!account()) {
        try {
          const about = await (await api(`${API}/about?fields=user(emailAddress)`)).json();
          if (about.user?.emailAddress) ls.set('email', about.user.emailAddress);
        } catch { /* optional */ }
      }
      // Only clear the dirty flag if nothing changed while we were syncing.
      if (Number(ls.get('dirtyAt') || 0) <= started) ls.set('lastSyncAt', Date.now());
      else ls.set('lastSyncAt', started);
      onStatus('synced');
    } catch (e) {
      if (e instanceof AuthError) onStatus('auth');
      else if (!navigator.onLine) onStatus('offline');
      else onStatus('error', e.message);
    }
  })().finally(() => { running = null; });
  return running;
}

// Bill file for viewing: local copy first, else download from Drive and cache it.
export async function getBill(att) {
  const local = await db.loadBlob(att.id);
  if (local) return local;
  if (!att.driveId || !tokenValid() || !navigator.onLine) return null;
  try {
    const blob = await (await api(`${API}/files/${att.driveId}?alt=media`)).blob();
    await db.saveBlob(att.id, blob);
    return blob;
  } catch { return null; }
}
