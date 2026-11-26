import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, getDoc, query, where } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';
import { firebaseConfig, planner } from './config.js?v=5';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AV = { yes: 'Available', part: 'Partly available', no: 'Unavailable' };
const TM = { any: 'Any time', morning: 'Mornings', day: 'Daytime', evening: 'Evenings', weekend: 'Weekends', none: '—' };
const RC = { yes: 'Reachable', slow: 'Slow to reply', no: "Can't be reached" };
const COLORS = ['#3F63D8', '#13A39B', '#2F9E5B', '#E3A008', '#EF6B4D', '#8B5CF6', '#D9488F', '#64748B'];
const STARTER = [
  ['t-travel', { name: 'Travel', color: '#E3A008', avail: 'no', time: 'none', reach: 'slow', order: 1 }],
  ['t-workeve', { name: 'Working, free on evenings', color: '#3F63D8', avail: 'part', time: 'evening', reach: 'yes', order: 2 }],
  ['t-freeeve', { name: 'Free all day, prefers evenings', color: '#13A39B', avail: 'yes', time: 'evening', reach: 'yes', order: 3 }],
  ['t-free', { name: 'Free all day', color: '#2F9E5B', avail: 'yes', time: 'any', reach: 'yes', order: 4 }],
  ['t-weekends', { name: 'Busy, weekends only', color: '#8B5CF6', avail: 'part', time: 'weekend', reach: 'yes', order: 5 }],
  ['t-offgrid', { name: 'Off the grid', color: '#64748B', avail: 'no', time: 'none', reach: 'no', order: 6 }],
];
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const P = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addD = (s, n) => { const t = P(s); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const len = (a, b) => Math.round((P(b) - P(a)) / 864e5) + 1;
const fd = (s, o) => P(s).toLocaleDateString('en-AU', Object.assign({ day: 'numeric', month: 'short', timeZone: 'UTC' }, o));
const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(P(s)) && P(s).toISOString().slice(0, 10) === s;
const col = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#64748B';
const onCol = c => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * 299 + (n >> 8 & 255) * 587 + (n & 255) * 114) / 1000 > 160 ? '#0E2235' : '#FFFFFF'; };
const pick = (v, o, d) => Object.prototype.hasOwnProperty.call(o, v) ? v : d;
const reachHTML = r => r === 'no' ? '<i class="r no" title="Can\'t be reached"></i>' : r === 'slow' ? '<i class="r slow" title="Slow to reply"></i>' : '';
const UNK = { name: 'Unknown type', color: '#94A3B8', avail: 'part', time: 'any', reach: 'yes' };
const nextMon = () => addD(TODAY, (8 - P(TODAY).getUTCDay()) % 7);
const typeDesc = t => `${AV[t.avail]}${t.avail !== 'no' && t.time !== 'none' ? ', ' + TM[t.time].toLowerCase() : ''}, ${RC[t.reach].toLowerCase()}`;
const fmtLen = n => n % 7 === 0 ? `${n / 7} week${n > 7 ? 's' : ''}` : `${n} day${n > 1 ? 's' : ''}`;
function fmtRange(a, b) {
  const A = P(a), B = P(b);
  if (a === b) return fd(a, { year: 'numeric' });
  if (A.getUTCFullYear() === B.getUTCFullYear() && A.getUTCMonth() === B.getUTCMonth()) return `${A.getUTCDate()}–${fd(b, { year: 'numeric' })}`;
  if (A.getUTCFullYear() === B.getUTCFullYear()) return `${fd(a)} – ${fd(b, { year: 'numeric' })}`;
  return `${fd(a, { year: 'numeric' })} – ${fd(b, { year: 'numeric' })}`;
}

document.title = planner.title || 'Availability planner';
$('#appTitle').textContent = document.title;

let cur = { y: now.getFullYear(), m: now.getMonth() };
let view = 'grid'; try { if (localStorage.getItem('ap-view') === 'cal') view = 'cal'; } catch (e) { }
let sel = null, editing = null, editingType = null, refocus = false, ST = {};
let me = null, isAdmin = false, myName = '', appOn = false, unsubs = [], meUnsub = null, pendingName = '', mode = 'in';
let members = new Map(), emails = new Map(), types = new Map(), blocks = new Map(), byPerson = new Map();
let loaded = { members: false, types: false, blocks: false };

const configured = !String(firebaseConfig.apiKey || '').startsWith('PASTE');
let auth = null, db = null;
if (configured) { const app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app); }

const team = () => [...members.values()].filter(m => m.status === 'approved').sort((a, b) => a.name.localeCompare(b.name));
const tps = () => [...types.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
const typeOf = b => types.get(b.type) || UNK;
const monthDays = () => { const n = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${cur.y}-${pad(cur.m + 1)}-${pad(i + 1)}`); };

/* ---------- screens ---------- */
function show(screen) {
  const inApp = screen === 'app';
  document.body.dataset.screen = screen;
  $('#gate').hidden = inApp; $('#gateHead').hidden = inApp;
  $('#app').hidden = $('#panels').hidden = $('#monthBar').hidden = $('#viewSeg').hidden = !inApp;
  for (const el of document.querySelectorAll('[data-screen]:not(body)')) el.hidden = el.dataset.screen !== screen;
  $('#account').hidden = !me;
}
function waiting(st) {
  stopApp(); show('waiting');
  $('#wUid').textContent = me ? me.uid : '';
  const who = planner.adminName || 'The organiser';
  const t = {
    pending: ['Waiting for approval', `Thanks${myName ? ', ' + myName : ''}. ${who} needs to approve you before you can see the team's plans. This page opens by itself once you're in.`],
    declined: ['Not on the team', `${who} hasn't added this account to the team. If that seems wrong, get in touch with them.`],
    error: ['Something went wrong', "Your access couldn't be checked. Reload the page, or sign out and back in."],
  }[st] || ['Waiting for approval', ''];
  $('#wTitle').textContent = t[0]; $('#wText').textContent = t[1];
}

/* ---------- auth ---------- */
const AUTH_MSG = {
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That email and password don’t match an account.',
  'auth/user-not-found': 'That email and password don’t match an account.',
  'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/weak-password': 'Use a password of at least 8 characters.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
  'auth/operation-not-allowed': 'This sign-in method hasn’t been switched on in Firebase yet.',
  'auth/unauthorized-domain': 'This website isn’t on the Firebase project’s list of authorised domains yet.',
  'auth/popup-closed-by-user': 'The Google window closed before sign-in finished.',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/network-request-failed': 'Couldn’t reach the sign-in service. Check your connection.',
};
const authMsg = e => AUTH_MSG[e && e.code] || 'Sign-in didn’t work. Try again.';
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('#nameRow').hidden = m !== 'up';
  $('#aGo').textContent = m === 'up' ? 'Create account' : 'Sign in';
  $('#aReset').hidden = m === 'up';
  $('#aPass').autocomplete = m === 'up' ? 'new-password' : 'current-password';
  $('#aErr').textContent = '';
}
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#aErr'); err.className = 'err'; err.textContent = '';
  const email = $('#aEmail').value.trim(), pass = $('#aPass').value;
  if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
  $('#aGo').disabled = true;
  try {
    if (mode === 'up') {
      const name = $('#aName').value.trim();
      if (!name) { err.textContent = 'Add your name so the team knows who you are.'; return; }
      if (pass.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      pendingName = name.slice(0, 40);
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      updateProfile(cred.user, { displayName: pendingName }).catch(() => { });
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (x) { err.textContent = authMsg(x); }
  finally { $('#aGo').disabled = false; }
});
$('#aReset').onclick = async () => {
  const err = $('#aErr'), email = $('#aEmail').value.trim();
  if (!email) { err.className = 'err'; err.textContent = 'Type your email above first.'; return; }
  try { await sendPasswordResetEmail(auth, email); } catch (x) { if (x && x.code === 'auth/invalid-email') { err.className = 'err'; err.textContent = authMsg(x); return; } }
  err.className = 'err ok'; err.textContent = 'If there’s an account for that email, a reset link is on its way.';
};
$('#aGoogle').onclick = async () => {
  $('#aErr').className = 'err'; $('#aErr').textContent = '';
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (x) { $('#aErr').textContent = authMsg(x); }
};
$('#signOut').onclick = $('#wSignOut').onclick = () => signOut(auth);
$('#copyUid').onclick = async () => { try { await navigator.clipboard.writeText(me.uid); toast('User ID copied'); } catch (e) { toast('Select the ID and copy it'); } };

function watchMe(user) {
  let creating = false;
  meUnsub = onSnapshot(doc(db, 'members', user.uid), async snap => {
    if (!snap.exists()) {
      if (creating) return; creating = true;
      const name = (pendingName || user.displayName || (user.email || '').split('@')[0] || 'New member').trim().slice(0, 40) || 'New member';
      try {
        await setDoc(doc(db, 'members', user.uid), { name, status: 'pending', requested: new Date().toISOString() });
        if (user.email) await setDoc(doc(db, 'emails', user.uid), { email: user.email });
      } catch (e) { console.warn(e); waiting('error'); }
      creating = false; return;
    }
    const m = snap.data() || {};
    myName = String(m.name || ''); $('#meName').textContent = myName;
    if (isAdmin && m.status !== 'approved') { try { await updateDoc(doc(db, 'members', user.uid), { status: 'approved' }); } catch (e) { console.warn(e); } return; }
    if (m.status === 'approved' || isAdmin) startApp(); else waiting(m.status === 'declined' ? 'declined' : 'pending');
  }, e => { console.warn(e); waiting('error'); });
}
if (!configured) show('setup');
else onAuthStateChanged(auth, async user => {
  stopApp(); if (meUnsub) { meUnsub(); meUnsub = null; }
  me = user; isAdmin = false; myName = '';
  if (!user) { setMode('in'); show('auth'); return; }
  $('#meName').textContent = user.displayName || user.email || '';
  show('loading');
  try { isAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch (e) { isAdmin = false; }
  watchMe(user);
});

/* ---------- data ---------- */
function ingestMembers(s) { members = new Map(); for (const d of s.docs) { const v = d.data() || {}; members.set(d.id, { id: d.id, name: String(v.name || 'Unnamed').slice(0, 40), status: pick(v.status, { pending: 1, approved: 1, declined: 1 }, 'pending'), requested: String(v.requested || '') }); } }
function ingestTypes(s) { types = new Map(); for (const d of s.docs) { const v = d.data() || {}; types.set(d.id, { id: d.id, name: String(v.name || 'Untitled').slice(0, 40), color: col(v.color), avail: pick(v.avail, AV, 'part'), time: pick(v.time, TM, 'any'), reach: pick(v.reach, RC, 'yes'), order: Number(v.order) || 0 }); } }
function ingestBlocks(s) {
  blocks = new Map(); byPerson = new Map();
  for (const d of s.docs) {
    const v = d.data() || {}; if (!isISO(v.start) || !isISO(v.end) || v.end < v.start) continue;
    const b = { id: d.id, uid: String(v.uid || ''), type: String(v.type || ''), start: v.start, end: v.end, note: String(v.note || '').slice(0, 200), created: String(v.created || '') };
    b.len = len(b.start, b.end); blocks.set(b.id, b);
    if (!byPerson.has(b.uid)) byPerson.set(b.uid, []); byPerson.get(b.uid).push(b);
  }
}
function startApp() {
  $('#adminTypes').hidden = $('#adminTeam').hidden = !isAdmin;
  if (appOn) { render(); return; }
  appOn = true; show('app'); $('#status').textContent = 'Loading the team’s plans…';
  const listen = (q, fn, key) => unsubs.push(onSnapshot(q, s => { fn(s); if (key) loaded[key] = true; if (loaded.members && loaded.types && loaded.blocks) $('#status').textContent = ''; render(); }, e => { console.warn(e); $('#status').textContent = 'Lost access to the shared data. Reload the page.'; }));
  listen(isAdmin ? collection(db, 'members') : query(collection(db, 'members'), where('status', '==', 'approved')), ingestMembers, 'members');
  listen(collection(db, 'types'), ingestTypes, 'types');
  listen(collection(db, 'blocks'), ingestBlocks, 'blocks');
  if (isAdmin) listen(collection(db, 'emails'), s => { emails = new Map(s.docs.map(d => [d.id, String((d.data() || {}).email || '')])); });
  resetBlock(); resetType();
  $('#rName').value = myName; $('#acctEmail').textContent = me.email ? `Signed in as ${me.email}.` : '';
  render();
}
function stopApp() {
  for (const u of unsubs) u(); unsubs = []; appOn = false;
  members = new Map(); emails = new Map(); types = new Map(); blocks = new Map(); byPerson = new Map();
  loaded = { members: false, types: false, blocks: false };
}
async function run(fn) {
  try { await fn(); return true; }
  catch (e) { console.warn(e); toast(e && e.code === 'permission-denied' ? 'You don’t have permission to do that.' : 'Couldn’t save. Check your connection and try again.'); return false; }
}
const put = (c, id, v) => run(() => setDoc(doc(db, c, id), v));
const patch = (c, id, v) => run(() => updateDoc(doc(db, c, id), v));
const del = (c, id) => run(() => deleteDoc(doc(db, c, id)));
const newId = c => doc(collection(db, c)).id;

/* ---------- capture ---------- */
function resolve(uid, d) { let best = null; for (const b of byPerson.get(uid) || []) { if (b.start <= d && d <= b.end && (!best || b.len < best.len || (b.len === best.len && b.created > best.created))) best = b; } return best; }
function stats(d, list) { const s = { yes: 0, part: 0, no: 0, unk: 0 }; for (const p of list) { const b = resolve(p.id, d); if (!b) { s.unk++; continue; } s[typeOf(b).avail]++; } s.score = s.yes + s.part / 2; return s; }
function ranges(ds) { if (!ds.length) return ''; const out = []; let a = ds[0], p = ds[0]; for (const d of ds.slice(1).concat([null])) { if (d && addD(p, 1) === d) { p = d; continue; } out.push(a === p ? fd(a) : `${P(a).getUTCDate()}–${fd(p)}`); a = p = d; } return out.slice(0, 4).join(', ') + (out.length > 4 ? ` and ${out.length - 4} more` : ''); }

function render() {
  if (!appOn) return;
  const days = monthDays(), list = team(); ST = {}; let max = 0;
  const rank = s => s.score * 100 + s.yes;
  for (const d of days) { ST[d] = stats(d, list); max = Math.max(max, rank(ST[d])); }
  const best = new Set(max ? days.filter(d => rank(ST[d]) === max) : []);
  const mName = new Date(Date.UTC(cur.y, cur.m, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  $('#month').textContent = mName;
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.v === view));
  const f = $('#finding');
  if (!list.length) f.textContent = 'Nobody is on the team yet.';
  else if (!max) f.textContent = `Nobody has marked themselves free in ${mName} yet.`;
  else { const s = ST[[...best][0]]; f.innerHTML = `Best overlap: <b>${esc(ranges([...best]))}</b>, with ${s.yes + s.part} of ${list.length} people free${s.part ? ` (${s.part} only partly)` : ''}.`; }
  $('#legend').innerHTML = tps().map(t => `<span class="lt"><i class="mini a-${t.avail}" style="--t:${t.color}">${reachHTML(t.reach)}</i><span><b>${esc(t.name)}</b><small>${typeDesc(t)}</small></span></span>`).join('') || `<span class="muted">No types yet.${isAdmin ? ' Add some under Types below.' : ''}</span>`;
  $('#board').innerHTML = view === 'grid' ? gridHTML(days, list, best) : calHTML(days, list, best);
  sizeGrid();
  renderDay(list); renderPanels();
  if (refocus) { refocus = false; document.querySelector(`[data-d="${sel}"][tabindex]`)?.focus(); }
}
function sizeGrid() { const t = document.querySelector('.grid'), th = t && t.querySelector('thead th.day'); if (th) t.style.setProperty('--colw', th.getBoundingClientRect().width + 'px'); }
new ResizeObserver(sizeGrid).observe($('#board'));

const dayCls = d => { const w = P(d).getUTCDay(); return `${w % 6 === 0 ? ' we' : ''}${d === TODAY ? ' td' : ''}${d === sel ? ' sel' : ''}`; };
function traceSVG(days, list, best) {
  const n = days.length, N = list.length, W = n * 100, H = 72, top = 12, bot = 9;
  const y = v => (H - bot - (v / N) * (H - top - bot)).toFixed(1);
  let path = `M0 ${y(ST[days[0]].score)}`;
  days.forEach((d, i) => { path += ` V${y(ST[d].score)} H${(i + 1) * 100}`; });
  const levels = N <= 8 ? Array.from({ length: N + 1 }, (_, k) => k) : [0, N / 2, N];
  const ns = 'vector-effect="non-scaling-stroke"';
  const grid = levels.map(k => `<line class="g" x1="0" x2="${W}" y1="${y(k)}" y2="${y(k)}" ${ns}/>`).join('');
  const weeks = days.map((d, i) => i && P(d).getUTCDay() === 1 ? `<line class="wk" x1="${i * 100}" x2="${i * 100}" y1="0" y2="${H}" ${ns}/>` : '').join('');
  const bst = days.map((d, i) => best.has(d) ? `<rect class="bst" x="${i * 100}" y="0" width="100" height="${H}"/>` : '').join('');
  const ti = days.indexOf(TODAY), si = days.indexOf(sel);
  const vline = (i, c) => i < 0 ? '' : `<line class="${c}" x1="${i * 100 + 50}" x2="${i * 100 + 50}" y1="0" y2="${H}" ${ns}/>`;
  return `<svg class="trace-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="How many people are free each day${best.size ? ', highest on ' + esc(ranges([...best])) : ''}">${bst}${grid}${weeks}<path class="area" d="${path} V${H} H0 Z"/><path class="sig" d="${path}" ${ns}/>${vline(ti, 'now')}${vline(si, 'cur')}</svg>`;
}
function rowCells(p, days) {
  const bs = days.map(d => resolve(p.id, d)); let h = '';
  for (let i = 0; i < days.length; i++) {
    const b = bs[i], d = days[i];
    if (!b) { h += `<td class="c z${dayCls(d)}" data-d="${d}" title="${esc(p.name)}: nothing entered"><div class="bar"></div></td>`; continue; }
    const t = typeOf(b), jl = i > 0 && bs[i - 1] === b, jr = i < days.length - 1 && bs[i + 1] === b;
    let lab = '';
    if (!jl) { let L = 1; while (i + L < days.length && bs[i + L] === b) L++; lab = `<span class="lab" style="--n1:${L}">${reachHTML(t.reach)}<b>${esc(t.name)}</b>${b.note ? `<span class="note">${esc(b.note)}</span>` : ''}</span>`; }
    const tip = `${p.name}: ${t.name}\n${typeDesc(t)}\n${fmtRange(b.start, b.end)}${b.note ? '\n' + b.note : ''}`;
    h += `<td class="c ${t.avail}${jl ? ' jl' : ''}${jr ? ' jr' : ''}${dayCls(d)}" style="--t:${t.color};--on:${onCol(t.color)};--i:${i}" data-d="${d}" title="${esc(tip)}"><div class="bar a-${t.avail}"></div>${lab}</td>`;
  }
  return h;
}
function gridHTML(days, list, best) {
  if (!list.length) return '<p class="empty">Nobody is on the team yet.</p>';
  const n = days.length;
  const head = days.map(d => `<th scope="col" class="day${dayCls(d)}" tabindex="0" data-d="${d}" aria-label="${fd(d, { weekday: 'long', month: 'long' })}"><span>${'SMTWTFS'[P(d).getUTCDay()]}</span>${P(d).getUTCDate()}</th>`).join('');
  const trace = `<tr class="trace"><th scope="row" class="who">Team<small>${list.length} ${list.length === 1 ? 'person' : 'people'}</small></th><td class="tr-cell" colspan="${n}" data-trace="1">${traceSVG(days, list, best)}</td></tr>`;
  const counts = `<tr class="counts"><th scope="row" class="who"><small>Free</small></th>${days.map(d => { const s = ST[d]; return `<td data-d="${d}" class="${best.has(d) ? 'best' : ''}${dayCls(d)}" title="${s.yes} free, ${s.part} partly, ${s.no} unavailable, ${s.unk} not entered">${s.yes + s.part}</td>`; }).join('')}</tr>`;
  const rows = list.map(p => `<tr><th scope="row" class="who" title="${esc(p.name)}">${esc(p.name)}${p.id === me.uid ? '<span class="you">you</span>' : ''}</th>${rowCells(p, days)}</tr>`).join('');
  return `<div class="gridwrap"><table class="grid" style="--n:${n}"><colgroup><col class="cw"><col span="${n}"></colgroup><thead><tr><th class="who"></th>${head}</tr></thead><tbody>${trace}${counts}${rows}</tbody></table></div>`;
}
function calHTML(days, list, best) {
  const off = (P(days[0]).getUTCDay() + 6) % 7;
  let h = '<div class="cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="dow">${x}</div>`).join('') + '<div></div>'.repeat(off);
  for (const d of days) {
    const w = P(d).getUTCDay(), s = ST[d];
    const rows = list.map(p => { const b = resolve(p.id, d); if (!b) return `<span class="pr dim"><i class="mini z"></i><span class="nm">${esc(p.name)}</span></span>`; const t = typeOf(b); return `<span class="pr" title="${esc(t.name)}"><i class="mini a-${t.avail}" style="--t:${t.color}">${reachHTML(t.reach)}</i><span class="nm">${esc(p.name)}</span></span>`; }).join('');
    h += `<div class="dc${w % 6 === 0 ? ' we' : ''}${d === TODAY ? ' today' : ''}${d === sel ? ' sel' : ''}${best.has(d) ? ' best' : ''}" role="button" tabindex="0" data-d="${d}" aria-label="${fd(d, { weekday: 'long', month: 'long' })}, ${s.yes + s.part} of ${list.length} free"><span class="hd"><span class="dn">${P(d).getUTCDate()}</span>${list.length ? `<span class="ds">${s.yes + s.part} of ${list.length} free</span>` : ''}</span><span class="ppl">${rows}</span></div>`;
  }
  return h + '</div>';
}
function renderDay(list) {
  const el = $('#day');
  if (!sel || !sel.startsWith(`${cur.y}-${pad(cur.m + 1)}-`)) { el.innerHTML = '<p class="hint">Pick a day to see who is free, when they’d rather work, and whether you can reach them.</p>'; return; }
  const rows = list.map(p => {
    const b = resolve(p.id, sel), mine = p.id === me.uid;
    if (!b) return `<tr><td><b>${esc(p.name)}</b></td><td class="muted">Nothing entered</td><td></td><td></td><td></td><td></td><td>${mine ? '<button class="btn sm" data-add="1">Add block</button>' : ''}</td></tr>`;
    const t = typeOf(b);
    return `<tr><td><b>${esc(p.name)}</b></td><td><span class="tchip"><i class="mini a-${t.avail}" style="--t:${t.color}"></i>${esc(t.name)}</span><span class="when">${fmtRange(b.start, b.end)}</span></td><td>${AV[t.avail]}</td><td>${t.avail === 'no' ? '—' : TM[t.time]}</td><td class="${t.reach === 'no' ? 'warn' : ''}">${RC[t.reach]}</td><td>${esc(b.note)}</td><td>${mine ? `<button class="btn sm" data-edit="${esc(b.id)}">Edit</button>` : ''}</td></tr>`;
  }).join('');
  const s = ST[sel] || { yes: 0, part: 0 };
  el.innerHTML = `<h3>${fd(sel, { weekday: 'long', month: 'long' })}</h3><p class="daysum">${s.yes} free all day, ${s.part} partly free, out of ${list.length}.</p>` + (list.length ? `<table class="dt stack"><thead><tr><th>Person</th><th>Block</th><th>Availability</th><th>Best time</th><th>Contact</th><th>Note</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '');
}
function renderPanels() {
  const t = tps(), ts = $('#bType'), keep = ts.value;
  ts.innerHTML = t.length ? t.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') : '<option value="">No types yet</option>';
  if ([...ts.options].some(o => o.value === keep)) ts.value = keep;
  const past = $('#showPast').checked;
  const mine = (byPerson.get(me.uid) || []).filter(b => past || b.end >= TODAY).sort((a, b) => a.start.localeCompare(b.start));
  $('#blist').innerHTML = mine.map(b => {
    const ty = typeOf(b);
    return `<li><i class="mini a-${ty.avail}" style="--t:${ty.color}">${reachHTML(ty.reach)}</i><div class="txt"><b>${esc(ty.name)}</b><div class="meta"><span>${fmtRange(b.start, b.end)}</span><span>${fmtLen(b.len)}</span>${b.note ? `<span>${esc(b.note)}</span>` : ''}</div></div><div class="act"><button class="btn sm" data-edit="${esc(b.id)}">Edit</button><button class="btn sm danger" data-delb="${esc(b.id)}">Delete</button></div></li>`;
  }).join('') || `<li><span class="empty-li">${past ? 'You haven’t added any blocks yet.' : 'No current or upcoming blocks. Add one above.'}</span></li>`;
  if (!isAdmin) return;
  const used = id => [...blocks.values()].filter(b => b.type === id).length;
  $('#starter').hidden = t.length > 0;
  $('#tlist').innerHTML = t.map(x => { const n = used(x.id); return `<li><i class="mini a-${x.avail}" style="--t:${x.color}">${reachHTML(x.reach)}</i><div class="txt"><b>${esc(x.name)}</b><div class="meta"><span>${typeDesc(x)}</span><span>${n} block${n === 1 ? '' : 's'}</span></div></div><div class="act"><button class="btn sm" data-editt="${esc(x.id)}">Edit</button><button class="btn sm danger" data-delt="${esc(x.id)}">Delete</button></div></li>`; }).join('') || '<li><span class="empty-li">No types yet.</span></li>';
  const all = [...members.values()].sort((a, b) => a.name.localeCompare(b.name));
  const line = (m, btns) => { const n = (byPerson.get(m.id) || []).length; const extra = m.status === 'approved' ? `<span>${n} block${n === 1 ? '' : 's'}</span>` : m.requested && isISO(m.requested.slice(0, 10)) ? `<span>Asked ${fd(m.requested.slice(0, 10))}</span>` : ''; return `<li><div class="txt"><b>${esc(m.name)}</b>${m.id === me.uid ? '<span class="tag">you</span>' : ''}<div class="meta"><span>${esc(emails.get(m.id) || 'No email')}</span>${extra}</div></div><div class="act">${btns}</div></li>`; };
  $('#reqList').innerHTML = all.filter(m => m.status === 'pending').map(m => line(m, `<button class="btn sm primary" data-approve="${esc(m.id)}">Approve</button><button class="btn sm danger" data-decline="${esc(m.id)}">Decline</button>`)).join('') || '<li><span class="empty-li">Nobody is waiting.</span></li>';
  $('#memList').innerHTML = all.filter(m => m.status === 'approved').map(m => line(m, m.id === me.uid ? '' : `<button class="btn sm danger" data-remove="${esc(m.id)}">${armed.get(m.id) || 'Remove'}</button>`)).join('');
  const dec = all.filter(m => m.status === 'declined');
  $('#decWrap').hidden = !dec.length;
  $('#decList').innerHTML = dec.map(m => line(m, `<button class="btn sm" data-approve="${esc(m.id)}">Approve</button><button class="btn sm danger" data-forget="${esc(m.id)}">${armed.get(m.id) || 'Forget'}</button>`)).join('');
}

/* ---------- toast ---------- */
let tt;
function toast(msg, undo) {
  const el = $('#toast'); el.textContent = '';
  const s = document.createElement('span'); s.textContent = msg; el.append(s);
  if (undo) { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'Undo'; b.onclick = async () => { el.hidden = true; await undo(); }; el.append(b); }
  el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, undo ? 8000 : 3500);
}

/* ---------- your blocks ---------- */
const go = s => { const el = $(s); el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); setTimeout(() => el.querySelector('select,input')?.focus({ preventScroll: true }), 350); };
function resetBlock() { editing = null; $('#bf').reset(); $('#bStart').value = nextMon(); $('#bEnd').value = addD($('#bStart').value, 13); $('#bSave').textContent = 'Add block'; $('#bCancel').hidden = $('#bDel').hidden = true; $('#bfTitle').textContent = 'Add a block'; $('#bErr').textContent = ''; }
function setLen(w) { let s = $('#bStart').value; if (!isISO(s)) { s = nextMon(); $('#bStart').value = s; } $('#bEnd').value = addD(s, 7 * w - 1); }
function startAdd(d) { resetBlock(); if (d) { $('#bStart').value = d; $('#bEnd').value = addD(d, 6); } go('#bf'); }
function editBlock(id) { const b = blocks.get(id); if (!b || b.uid !== me.uid) return; resetBlock(); editing = id; $('#bType').value = b.type; $('#bStart').value = b.start; $('#bEnd').value = b.end; $('#bNote').value = b.note; $('#bSave').textContent = 'Save changes'; $('#bCancel').hidden = $('#bDel').hidden = false; $('#bfTitle').textContent = 'Edit block'; go('#bf'); }
const rawB = b => ({ uid: b.uid, type: b.type, start: b.start, end: b.end, note: b.note, created: b.created });
async function delBlock(id) { const b = blocks.get(id); if (!b || b.uid !== me.uid) return; const body = rawB(b); if (await del('blocks', id)) { if (editing === id) resetBlock(); toast('Block deleted', () => put('blocks', id, body)); } }
$('#bf').addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#bErr'); err.textContent = '';
  const v = { uid: me.uid, type: $('#bType').value, start: $('#bStart').value, end: $('#bEnd').value, note: $('#bNote').value.trim().slice(0, 200) };
  if (!types.has(v.type)) { err.textContent = isAdmin ? 'Add a type first, under Types.' : 'There are no types to choose from yet. Ask the organiser to add some.'; return; }
  if (!isISO(v.start) || !isISO(v.end)) { err.textContent = 'Pick a start and an end date.'; return; }
  if (v.end < v.start) { err.textContent = 'The end date is before the start date.'; return; }
  if (len(v.start, v.end) > 731) { err.textContent = 'Keep a single block under two years.'; return; }
  const old = editing ? blocks.get(editing) : null; v.created = old ? old.created : new Date().toISOString();
  const id = editing || newId('blocks'), was = !!editing;
  $('#bSave').disabled = true;
  const ok = await put('blocks', id, v);
  $('#bSave').disabled = false;
  if (ok) { toast(was ? 'Block updated' : 'Block added'); sel = v.start; cur = { y: +v.start.slice(0, 4), m: +v.start.slice(5, 7) - 1 }; resetBlock(); render(); }
});
$('#bCancel').onclick = resetBlock;
$('#bDel').onclick = () => editing && delBlock(editing);
$('#bStart').addEventListener('change', () => { const s = $('#bStart').value, e = $('#bEnd').value; if (isISO(s) && (!isISO(e) || e < s)) $('#bEnd').value = addD(s, 6); });
$('#showPast').onchange = renderPanels;
$('#renameForm').addEventListener('submit', async e => {
  e.preventDefault(); const name = $('#rName').value.trim().slice(0, 40), err = $('#rErr'); err.textContent = '';
  if (!name) { err.textContent = 'Your name can’t be empty.'; return; }
  if (name === myName) return;
  if (await patch('members', me.uid, { name })) { updateProfile(me, { displayName: name }).catch(() => { }); toast('Name updated'); }
});

/* ---------- admin: types ---------- */
$('#tColors').innerHTML = COLORS.map((c, i) => `<label><input type="radio" name="tc" value="${c}"${i ? '' : ' checked'} aria-label="Colour ${i + 1}"><span style="background:${c}"></span></label>`).join('');
function resetType() { editingType = null; $('#tf').reset(); $('#tSave').textContent = 'Add type'; $('#tfTitle').textContent = 'New type'; $('#tCancel').hidden = true; $('#tErr').textContent = ''; const usedC = new Set(tps().map(t => t.color.toUpperCase())); const free = COLORS.find(c => !usedC.has(c)) || COLORS[0]; document.querySelector(`[name=tc][value="${free}"]`).checked = true; }
function editType(id) { const t = types.get(id); if (!t) return; resetType(); editingType = id; $('#tName').value = t.name; const r = document.querySelector(`[name=tc][value="${t.color.toUpperCase()}"]`); if (r) r.checked = true; $('#tAvail').value = t.avail; $('#tTime').value = t.time; $('#tReach').value = t.reach; $('#tSave').textContent = 'Save type'; $('#tfTitle').textContent = 'Edit type'; $('#tCancel').hidden = false; go('#tf'); }
async function delType(id) {
  const t = types.get(id); if (!t) return;
  const n = [...blocks.values()].filter(b => b.type === id).length;
  if (n) { toast(`${n} block${n === 1 ? ' uses' : 's use'} this type, so it can’t be deleted. Rename it instead.`); return; }
  const body = { name: t.name, color: t.color, avail: t.avail, time: t.time, reach: t.reach, order: t.order };
  if (await del('types', id)) { if (editingType === id) resetType(); toast('Type deleted', () => put('types', id, body)); }
}
$('#tf').addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#tErr'); err.textContent = '';
  const v = { name: $('#tName').value.trim().slice(0, 40), color: col(document.querySelector('[name=tc]:checked')?.value), avail: pick($('#tAvail').value, AV, 'part'), time: pick($('#tTime').value, TM, 'any'), reach: pick($('#tReach').value, RC, 'yes') };
  if (!v.name) { err.textContent = 'Give the type a name.'; return; }
  if (tps().some(t => t.id !== editingType && t.name.toLowerCase() === v.name.toLowerCase())) { err.textContent = 'There’s already a type with that name.'; return; }
  v.order = editingType ? types.get(editingType).order : Math.max(0, ...tps().map(t => t.order)) + 1;
  const was = !!editingType;
  if (await put('types', editingType || newId('types'), v)) { toast(was ? 'Type updated' : 'Type added'); resetType(); }
});
$('#tCancel').onclick = resetType;
$('#starter').onclick = async () => { for (const [id, v] of STARTER) if (!await put('types', id, v)) return; toast('Starter types added'); resetType(); };

/* ---------- admin: team ---------- */
const armed = new Map();
async function confirmThen(btn, label, fn) {
  const key = btn.dataset.remove || btn.dataset.forget;
  if (armed.get(key) !== label) { armed.set(key, label); btn.textContent = label; setTimeout(() => { if (armed.get(key) === label) { armed.delete(key); renderPanels(); } }, 4000); return; }
  armed.delete(key); await fn();
}
async function removeMember(uid) {
  for (const b of byPerson.get(uid) || []) if (!await del('blocks', b.id)) return;
  if (await patch('members', uid, { status: 'declined' })) toast(`${members.get(uid)?.name || 'They'} removed`);
}

/* ---------- copy & nav ---------- */
$('#copy').onclick = async () => {
  const days = monthDays(), lines = [`Availability, ${$('#month').textContent}`, $('#finding').textContent, ''];
  for (const p of team()) {
    const segs = []; let c = null;
    for (const d of days) { const b = resolve(p.id, d); if (c && c.b === b) c.to = d; else { c = { b, from: d, to: d }; segs.push(c); } }
    lines.push(p.name + ':');
    for (const s of segs) { if (!s.b) continue; const t = typeOf(s.b); lines.push(`  ${s.from === s.to ? fd(s.from) : P(s.from).getUTCDate() + '–' + fd(s.to)}: ${t.name} (${typeDesc(t).toLowerCase()})${s.b.note ? ', ' + s.b.note : ''}`); }
    if (!segs.some(s => s.b)) lines.push('  nothing entered');
  }
  const txt = lines.join('\n'), out = $('#copyOut');
  try { await navigator.clipboard.writeText(txt); out.hidden = true; toast('Month copied'); }
  catch (e) { out.value = txt; out.hidden = false; out.focus(); out.select(); toast('Select all and copy the text below'); }
};
$('#prev').onclick = () => { if (--cur.m < 0) { cur.m = 11; cur.y--; } render(); };
$('#next').onclick = () => { if (++cur.m > 11) { cur.m = 0; cur.y++; } render(); };
$('#today').onclick = () => { cur = { y: now.getFullYear(), m: now.getMonth() }; sel = TODAY; render(); };

document.addEventListener('click', e => {
  const tc = e.target.closest('[data-trace]');
  if (tc) { const r = tc.getBoundingClientRect(), days = monthDays(); sel = days[Math.min(days.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * days.length)))]; render(); return; }
  const t = e.target.closest('button,[data-d]'); if (!t) return; const ds = t.dataset;
  if (ds.mode) return setMode(ds.mode);
  if (ds.edit) return editBlock(ds.edit);
  if (ds.delb) return delBlock(ds.delb);
  if (ds.add) return startAdd(sel);
  if (ds.editt) return editType(ds.editt);
  if (ds.delt) return delType(ds.delt);
  if (ds.approve) return patch('members', ds.approve, { status: 'approved' }).then(ok => ok && toast(`${members.get(ds.approve)?.name || 'They'} can now see the planner`));
  if (ds.decline) return patch('members', ds.decline, { status: 'declined' });
  if (ds.remove) return confirmThen(t, 'Confirm remove', () => removeMember(ds.remove));
  if (ds.forget) return confirmThen(t, 'Confirm forget', async () => { if (await del('members', ds.forget)) await del('emails', ds.forget); });
  if (ds.w) return setLen(+ds.w);
  if (ds.v) { view = ds.v === 'cal' ? 'cal' : 'grid'; try { localStorage.setItem('ap-view', view); } catch (_) { } return render(); }
  if (ds.d) { sel = ds.d; render(); }
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-d][tabindex]')) { e.preventDefault(); refocus = true; e.target.click(); } });
