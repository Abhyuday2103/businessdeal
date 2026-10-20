import * as E from './engine.js';
import { firebaseConfig } from './firebase-config.js';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('bd_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bd_' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem('bd_' + k); } catch (e) { /* storage blocked */ } },
};
const params = new URLSearchParams(location.search);
const EMU = params.get('emu'); // ?emu=127.0.0.1 runs against the local Firebase emulators (testing only)
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function loading(on, msg = 'Connecting') { $('#loading').hidden = !on; $('#loading-msg').textContent = msg; }
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const R = E.rupees;
const PCOL = ['#d93a3a', '#2563eb', '#0f9d76', '#8b3fd9', '#e08a00', '#30302f'];
const LIGHT = new Set([5]); // groups whose colour needs dark text
const ICON = { Roadways: '🚌', Waterways: '⛴️', Airways: '✈️', Railways: '🚂', 'BEST Electric': '⚡', Petroleum: '⛽' };
const SHORT = { 'Community Chest': 'Comm. Chest', 'BEST Electric': 'BEST', 'Income Tax': 'Income Tax', 'Wealth Tax': 'Wealth Tax' };

// ---------- practice: the whole game runs in this browser ----------
class LocalServer {
  constructor(name, bots) {
    this.mode = 'local';
    this.uid = 'me';
    this.code = 'PRACTICE';
    this.st = E.createTable('PRACTICE', 'me', name);
    for (let i = 0; i < bots; i++) E.dispatch(this.st, 'me', { type: 'addBot' }, Date.now());
    this.timer = setInterval(() => {
      let acted = false;
      try { acted = E.runBots(this.st, Date.now()); } catch (e) { console.error(e); }
      if (acted) this.emit();
    }, 150);
  }
  watch(cb) { this.cb = cb; this.emit(); }
  emit() { this.st.now = Date.now(); lastOk = Date.now(); if (this.cb) this.cb(E.viewFor(this.st, this.uid)); }
  async act(a) {
    const snap = structuredClone(this.st);
    try { E.dispatch(this.st, this.uid, a, Date.now()); } catch (e) { this.st = snap; throw e; }
    this.emit();
  }
  stop() { clearInterval(this.timer); }
}

// ---------- online: the Firebase function runs the table. ----------
let fb = null;
async function firebase() {
  if (fb) return fb;
  if (!firebaseConfig) throw new Error('Online play is not set up yet. Add your Firebase config (see README).');
  const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [appM, authM, fsM, fnM] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js'].map((f) => import(base + f)));
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  if (EMU) authM.connectAuthEmulator(auth, `http://${EMU}:9099`, { disableWarnings: true });
  await auth.authStateReady();
  if (!auth.currentUser) await authM.signInAnonymously(auth);
  const db = fsM.initializeFirestore(app, { experimentalForceLongPolling: true });
  if (EMU) fsM.connectFirestoreEmulator(db, EMU, 8080);
  const fns = fnM.getFunctions(app);
  if (EMU) fnM.connectFunctionsEmulator(fns, EMU, 5001);
  const call = fnM.httpsCallable(fns, 'bd', { timeout: 15000 });
  const uid = auth.currentUser.uid;
  const viewRef = (id) => fsM.doc(db, 'btables', id, 'views', uid);
  const readView = (s) => (s.exists() ? JSON.parse(s.data().json) : null);
  fb = {
    uid,
    call: async (data) => {
      const sent = Date.now();
      try {
        const r = (await call(data)).data;
        if (r && r.view && r.view.serverNow) offset = r.view.serverNow - (sent + Date.now()) / 2;
        lastOk = Date.now();
        return r;
      } catch (e) { throw new Error(e.message || 'Request failed'); }
    },
    watch: (id, cb) => fsM.onSnapshot(viewRef(id), (s) => { lastOk = Date.now(); const v = readView(s); if (v) cb(v); }, () => { /* the poll covers it */ }),
    get: async (id) => { const s = await fsM.getDocFromServer(viewRef(id)); lastOk = Date.now(); return readView(s); },
    ping: (id) => fsM.setDoc(fsM.doc(db, 'btables', id, 'presence', uid), { at: fsM.serverTimestamp() }),
    watchPresence: (id, cb) => fsM.onSnapshot(fsM.collection(db, 'btables', id, 'presence'), (qs) => {
      const out = {};
      qs.forEach((d) => { const at = d.data({ serverTimestamps: 'estimate' }).at; out[d.id] = at && at.toMillis ? at.toMillis() : 0; });
      cb(out);
    }, () => {}),
  };
  return fb;
}
const computer = (p) => p && (p.bot || p.auto);
// Mirrors runBots: is there a computer move (or a timer) the server should handle now?
function serverDue(v) {
  if (v.phase !== 'play') return false;
  const P = (u) => v.players.find((x) => x.uid === u);
  if (v.step === 'auction' && v.auction && srvNow() >= v.auction.endsAt) return true;
  if (v.trade && v.trade.at && srvNow() - v.trade.at > E.TRADE_MS) return true;
  if (srvNow() < v.botAt) return false;
  if (v.trade && computer(P(v.trade.to))) return true;
  if (v.debts.length) return computer(P(v.debts[0].uid));
  if (v.step === 'auction' && v.auction) return v.auction.in.some((u) => u !== v.auction.by && computer(P(u)));
  return computer(P(v.turn));
}
class CloudServer {
  constructor(api, code) { this.mode = 'cloud'; this.api = api; this.code = code; this.uid = api.uid; this.ticking = false; }
  watch(cb) {
    this.cb = cb;
    this.unsub = this.api.watch(this.code, cb);
    this.unsubP = this.api.watchPresence(this.code, (p) => { presence = p; render(); });
    this.poll = setInterval(() => this.refresh(), 3000);
    this.tickTimer = setInterval(() => this.tick(), 500);
    this.pingTimer = setInterval(() => this.ping(), 25000);
    this.ping();
    this.onWake = () => { if (document.visibilityState === 'visible') { this.relisten(); this.ping(); } };
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
  }
  ping() { this.api.ping(this.code).catch(() => {}); }
  relisten() {
    if (this.unsub) this.unsub();
    this.unsub = this.api.watch(this.code, this.cb);
    this.refresh();
  }
  async refresh() { try { const v = await this.api.get(this.code); if (v) this.cb(v); } catch (e) { /* next poll */ } }
  // Computer players, autopilot seats and auction timers move when one browser nudges the server.
  // Only one browser does the nudging: the first connected human in seat order.
  async tick() {
    const v = view;
    if (this.ticking || !v || !serverDue(v)) return;
    const nudger = v.players.find((x) => !x.bot && !x.auto && !x.left && isOnline(x.uid)) || v.players.find((x) => x.uid === this.uid);
    if (nudger.uid !== this.uid) return;
    this.ticking = true;
    try { const r = await this.api.call({ op: 'tick', tableId: this.code }); if (r && r.view) this.cb(r.view); } catch (e) { /* ignore */ }
    setTimeout(() => { this.ticking = false; }, 400);
  }
  async act(a) {
    const r = await withTimeout(this.api.call({ op: 'act', tableId: this.code, action: { ...a, rid: rid(), move: view ? view.moveNo : undefined } }), 12000);
    if (r && r.view) this.cb(r.view);
    if (r && r.ok === false) throw new Error(r.error || 'Try again.');
  }
  stop() {
    if (this.unsub) this.unsub();
    if (this.unsubP) this.unsubP();
    clearInterval(this.poll); clearInterval(this.tickTimer); clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
  }
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('That took too long. Check your connection and try again.')), ms))]);
}

// ---------- app state ----------
let server = null;
let view = null;
let offset = 0;
let lastOk = Date.now();
let presence = {};
const srvNow = () => Date.now() + offset;
const AWAY = 70000;
const isOnline = (uid) => !server || server.mode === 'local' || (presence[uid] && srvNow() - presence[uid] < AWAY);
const ui = { busy: false, sheet: null, disp: {}, walkTimer: null, lastLog: null, cardN: null, cardTimer: null, spin: false, overSeen: '', tradeSeen: '', draft: null };

function onView(v) {
  if (!v || !Array.isArray(v.players)) return;
  if (view && v.id === view.id && v.seq < view.seq) return; // older than what we have
  const prev = view && view.id === v.id ? view : null;
  view = v;
  // New log lines since last time: spin the dice if someone rolled.
  const L = v.log || [];
  if (prev) {
    const k = ui.lastLog == null ? -1 : L.lastIndexOf(ui.lastLog);
    const fresh = L.slice(k + 1);
    if (fresh.some((l) => / rolled \d/.test(l))) ui.spin = true;
  }
  ui.lastLog = L.length ? L[L.length - 1] : null;
  // A newly drawn Chance / Community Chest card pops up on the board for a moment.
  if (v.card && v.card.n !== ui.cardN) {
    if (ui.cardN !== null || (prev && prev.phase === 'play')) showCard(v.card);
    ui.cardN = v.card.n;
  } else if (!v.card) ui.cardN = 0;
  // Tokens walk square by square to where they ended up.
  for (const p of v.players) if (!(p.uid in ui.disp) || !prev) ui.disp[p.uid] = p.pos;
  walk();
  render();
}
function walk() {
  if (ui.walkTimer || !view) return;
  const step = () => {
    let moving = false;
    for (const p of view.players) {
      const d = ui.disp[p.uid];
      if (d === p.pos) continue;
      const ahead = (p.pos - d + E.N) % E.N;
      // Forward moves walk; long or backward jumps (jail, cards that send you back) snap.
      ui.disp[p.uid] = ahead > 0 && ahead <= 12 ? (d + 1) % E.N : p.pos;
      moving = true;
    }
    renderTokens(view);
    if (moving) ui.walkTimer = setTimeout(step, 140); else ui.walkTimer = null;
  };
  step();
}
function showCard(card) {
  const el = $('#drawn');
  const chance = card.deck === 'chance';
  const who = view.players.find((p) => p.uid === card.by);
  el.style.setProperty('--cc', chance ? 'var(--chance)' : 'var(--chest)');
  el.innerHTML = `<h4>${chance ? 'Chance' : 'Community Chest'}</h4><p>${esc(card.t)}</p><small>${esc(who ? (who.uid === view.me ? 'You' : who.name) : '')}</small>`;
  el.hidden = false;
  clearTimeout(ui.cardTimer);
  ui.cardTimer = setTimeout(() => { el.hidden = true; }, 3400);
}
$('#drawn').onclick = () => { $('#drawn').hidden = true; };

async function act(a) {
  if (!server || ui.busy) return false;
  ui.busy = true;
  render();
  try { await server.act(a); return true; }
  catch (e) { toast(e.message); return false; }
  finally { ui.busy = false; render(); }
}

// ---------- home ----------
const nameInput = $('#name');
nameInput.value = store.get('name', '');
const getName = () => {
  const n = nameInput.value.trim();
  if (!n) { nameInput.focus(); toast('Put your name in first.'); return null; }
  store.set('name', n);
  return n;
};
if (!firebaseConfig) {
  $('#online-note').hidden = false;
  $('#online-note').textContent = 'Online tables need the one-time Firebase setup in the README. Practice works now.';
}
if (params.get('t')) {
  $('#code').value = params.get('t').toUpperCase();
  $('#join').classList.add('primary');
  if (!nameInput.value) setTimeout(() => nameInput.focus(), 50);
}
$('#create').onclick = async () => {
  const name = getName(); if (!name) return;
  loading(true, 'Making your table');
  try {
    const api = await firebase();
    const r = await api.call({ op: 'create', name });
    enterCloud(api, r.tableId, r.view);
  } catch (e) { toast(e.message); }
  finally { loading(false); }
};
async function joinCode(code, quiet) {
  const name = quiet ? (store.get('name', '') || getName()) : getName(); if (!name) return;
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) { toast('Type the table code.'); return; }
  loading(true, quiet ? 'Getting back to your table' : 'Joining');
  try {
    const api = await firebase();
    const r = await api.call({ op: 'join', tableId: code, name });
    enterCloud(api, r.tableId, r.view);
  } catch (e) {
    toast(e.message, 4500);
    if (quiet) store.del('table');
    clearUrl();
  } finally { loading(false); }
}
$('#join').onclick = () => joinCode($('#code').value);
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode($('#code').value); });
$('#practice').onclick = () => {
  const name = getName(); if (!name) return;
  leaveServer();
  server = new LocalServer(name, Number($('#bots').value));
  server.watch(onView);
};
function enterCloud(api, code, v) {
  leaveServer();
  server = new CloudServer(api, code);
  store.set('table', code);
  const u = new URL(location.href); u.searchParams.set('t', code); history.replaceState(null, '', u);
  onView(v);
  server.watch(onView);
}
function clearUrl() { const u = new URL(location.href); u.searchParams.delete('t'); history.replaceState(null, '', u); }
function leaveServer() {
  if (server) server.stop();
  server = null; view = null; presence = {};
  ui.disp = {}; ui.lastLog = null; ui.cardN = null; ui.overSeen = ''; ui.tradeSeen = '';
  closeSheet();
}
function goHome() {
  leaveServer();
  store.del('table');
  clearUrl();
  render();
}
async function leaveTable() {
  if (!server) return goHome();
  if (server.mode === 'cloud') {
    const midGame = view && view.phase === 'play';
    if (midGame && !confirm('Leave the game? The computer will play your seat. You can come back with the same link.')) return;
    try { await server.act({ type: 'leave' }); } catch (e) { /* leaving anyway */ }
  }
  goHome();
}
async function copyInvite() {
  const u = new URL(location.href);
  u.search = ''; u.searchParams.set('t', server.code);
  if (EMU) u.searchParams.set('emu', EMU);
  const link = u.toString();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Business Deal', text: `Join my Business Deal table: ${server.code}`, url: link }); return; } catch (e) { /* fall through to copy */ }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); }
  catch (e) { prompt('Copy this link:', link); }
}

// ---------- render ----------
function show(id) { for (const s of ['home', 'lobby', 'table']) $('#' + s).hidden = s !== id; }
function render() {
  if (!server || !view) { show('home'); $('#recon').hidden = true; return; }
  if (view.phase === 'lobby') { show('lobby'); renderLobby(view); } else { show('table'); renderTable(view); }
  autoSheets(view);
  if (ui.sheet && !STATIC_SHEETS.has(ui.sheet.split(':')[0])) renderSheet();
  renderRecon();
}
function renderRecon() {
  const cloud = server && server.mode === 'cloud';
  const gone = cloud && (!navigator.onLine || Date.now() - lastOk > 10000);
  $('#recon').hidden = !gone;
  $('#recon-reload').hidden = !(gone && Date.now() - lastOk > 25000);
  $('#recon-msg').textContent = !navigator.onLine ? 'Your phone is offline. Your seat is saved.' : 'Lost the connection for a moment. Your seat is saved.';
}
setInterval(() => { if (server) renderRecon(); }, 1000);
window.addEventListener('offline', () => renderRecon());
$('#recon-reload').onclick = () => location.reload();

const colorOf = (v, uid) => PCOL[Math.max(0, v.players.findIndex((p) => p.uid === uid)) % PCOL.length];
const nameOf = (v, uid) => { const p = v.players.find((x) => x.uid === uid); return p ? (p.uid === v.me ? 'You' : p.name) : 'Bank'; };
const tokenHTML = (v, uid) => `<span class="token" style="background:${colorOf(v, uid)}"></span>`;

// ---------- lobby ----------
function renderLobby(v) {
  const host = v.hostUid === v.me;
  const local = server.mode === 'local';
  $('#lobby-code').textContent = local ? 'Practice' : v.id;
  $('#code-panel').hidden = local;
  $('#lobby-count').textContent = `${v.players.length} of ${E.MAX_PLAYERS}`;
  $('#lobby-players').innerHTML = v.players.map((p) => {
    const tags = [p.uid === v.hostUid ? '<span class="pill host">Host</span>' : '', p.uid === v.me ? '<span class="pill you">You</span>' : '', p.bot ? '<span class="pill">Computer</span>' : ''].join('');
    const online = p.bot || isOnline(p.uid);
    const rm = host && p.uid !== v.me ? `<button class="x" data-remove="${esc(p.uid)}" aria-label="Remove ${esc(p.name)}">&times;</button>` : '';
    return `<li><span class="dot ${online ? '' : 'off'}" title="${online ? 'Connected' : 'Not connected'}"></span><span class="pname">${esc(p.name)}</span>${tags}${rm}</li>`;
  }).join('');
  $('#host-tools').hidden = !host;
  $('#add-bot').disabled = v.players.length >= E.MAX_PLAYERS || ui.busy;
  const start = $('#start');
  start.hidden = !host;
  start.disabled = v.players.length < E.MIN_PLAYERS || ui.busy;
  start.textContent = v.players.length < E.MIN_PLAYERS ? 'Need 1 more player' : `Start the game (${v.players.length} players)`;
  $('#lobby-wait').textContent = host ? (local ? '' : 'Waiting for friends? Share the link. Computer players fill empty seats.') : 'Waiting for the host to start.';
  renderSettings(v, host);
}
const CLUB = { money: 'Club pays, Rest collects', old: 'Old style' };
function renderSettings(v, host) {
  const s = v.settings;
  const lines = [
    `Everyone starts with ${R(s.startCash)}, and gets ${R(s.salary)} for crossing Start`,
    s.lapFirst ? 'Cross Start once before you can buy' : 'Buy from your first roll',
    s.auctions ? 'Property you pass on goes to auction' : 'No auctions',
    s.clubRest === 'money' ? 'Club House: pay ₹100 to each player. Rest House: collect ₹100 from each' : 'Club House: pay ₹100 to the bank. Rest House: miss your next turn',
    `Jail fine ${R(s.jailFine)}`,
    s.roll12 ? 'Roll a 12 to leave Start' : '',
    s.roundLimit ? `Richest player after ${s.roundLimit} rounds wins` : 'Play until one player is left standing',
  ].filter(Boolean);
  if (!host) {
    $('#settings').innerHTML = `<ul class="set-read">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
    return;
  }
  const seg = (key, opts) => `<div class="seg">${Object.entries(opts).map(([k, l]) => `<button type="button" data-set="${key}" data-val="${k}" class="${String(s[key]) === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sel = (key, opts) => `<select data-set="${key}" aria-label="${key}">${opts.map(([val, l]) => `<option value="${val}" ${String(s[key]) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('#settings').innerHTML = `<div class="set-grid">
    <div class="set-row"><span class="lbl">Starting money<small>Each player</small></span>${sel('startCash', [[10000, '₹10,000'], [15000, '₹15,000'], [20000, '₹20,000'], [25000, '₹25,000']])}</div>
    <div class="set-row"><span class="lbl">Start salary<small>Every time you cross Start</small></span>${sel('salary', [[1000, '₹1,000'], [1500, '₹1,500'], [2000, '₹2,000']])}</div>
    <div class="set-row"><span class="lbl">Cross Start first<small>No buying on your first lap</small></span>${seg('lapFirst', { true: 'On', false: 'Off' })}</div>
    <div class="set-row"><span class="lbl">Auctions<small>When someone passes on a property</small></span>${seg('auctions', { true: 'On', false: 'Off' })}</div>
    <div class="set-row"><span class="lbl">Club &amp; Rest House<small>${s.clubRest === 'money' ? 'Club: pay ₹100 each. Rest: collect ₹100 each' : 'Club: ₹100 to bank. Rest: miss a turn'}</small></span>${seg('clubRest', CLUB)}</div>
    <div class="set-row"><span class="lbl">Jail fine</span>${sel('jailFine', [[200, '₹200'], [500, '₹500'], [1000, '₹1,000']])}</div>
    <div class="set-row"><span class="lbl">Roll 12 to begin<small>Old rule, slow start</small></span>${seg('roll12', { true: 'On', false: 'Off' })}</div>
    <div class="set-row"><span class="lbl">Game length<small>${s.roundLimit ? 'Richest wins at the end' : 'Last one standing wins'}</small></span>${sel('roundLimit', [[0, 'Till bankrupt'], [15, '15 rounds'], [20, '20 rounds'], [30, '30 rounds'], [40, '40 rounds']])}</div>
  </div>`;
}
$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-set]');
  if (!b) return;
  let val = b.dataset.val;
  if (val === 'true' || val === 'false') val = val === 'true';
  act({ type: 'settings', settings: { [b.dataset.set]: val } });
});
$('#settings').addEventListener('change', (e) => {
  const el = e.target.closest('select[data-set]');
  if (el) act({ type: 'settings', settings: { [el.dataset.set]: Number(el.value) } });
});
$('#lobby-players').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (b) act({ type: 'remove', uid: b.dataset.remove });
});
$('#add-bot').onclick = () => act({ type: 'addBot' });
$('#start').onclick = () => act({ type: 'start' });
$('#copy-link').onclick = copyInvite;
$('#lobby-leave').onclick = leaveTable;

// ---------- the board ----------
// Square 0 (Start) is the bottom-right corner; play runs left along the bottom, up the left, right along the top, down the right.
function cellOf(i) {
  if (i === 0) return { r: 10, c: 10, side: 'b' };
  if (i < 9) return { r: 10, c: 10 - i, side: 'b' };
  if (i === 9) return { r: 10, c: 1, side: 'b' };
  if (i < 18) return { r: 10 - (i - 9), c: 1, side: 'l' };
  if (i === 18) return { r: 1, c: 1, side: 't' };
  if (i < 27) return { r: 1, c: 1 + (i - 18), side: 't' };
  if (i === 27) return { r: 1, c: 10, side: 't' };
  return { r: 1 + (i - 27), c: 10, side: 'r' };
}
const TRACK = [1.45, 1, 1, 1, 1, 1, 1, 1, 1, 1.45];
const TOTAL = TRACK.reduce((a, b) => a + b, 0);
const centerPct = (k) => { let s = 0; for (let j = 0; j < k - 1; j++) s += TRACK[j]; return ((s + TRACK[k - 1] / 2) / TOTAL) * 100; };
const CORNER = { start: ['➜', 'Start'], jail: ['⛓️', 'Jail'], club: ['🍸', 'Club House'], rest: ['🛏️', 'Rest House'] };
function buildBoard() {
  const b = $('#board');
  const html = E.BOARD.map((sq, i) => {
    const { r, c, side } = cellOf(i);
    const corner = CORNER[sq.kind];
    let inner;
    if (corner) inner = `<span class="body"><span class="ic">${corner[0]}</span><span class="nm">${corner[1]}</span></span>`;
    else if (sq.kind === 'city') inner = `<span class="band" style="--g:${E.GROUPS[sq.g].color}"></span><span class="body"><span class="nm">${sq.name}</span><span class="pr">${R(sq.price)}</span></span>`;
    else if (sq.kind === 'chance') inner = `<span class="body"><span class="ic" style="color:var(--chance);font-weight:800">?</span><span class="nm">Chance</span></span>`;
    else if (sq.kind === 'chest') inner = `<span class="body"><span class="ic">🎁</span><span class="nm">${SHORT[sq.name]}</span></span>`;
    else if (sq.kind === 'tax') inner = `<span class="body"><span class="ic">🧾</span><span class="nm">${sq.name}</span></span>`;
    else inner = `<span class="body"><span class="ic">${ICON[sq.name] || '•'}</span><span class="nm">${SHORT[sq.name] || sq.name}</span><span class="pr">${R(sq.price)}</span></span>`;
    return `<button type="button" class="sq ${side} ${sq.kind} ${corner ? 'corner' : ''}" data-sq="${i}" style="grid-row:${r};grid-column:${c}" aria-label="${esc(sq.name)}">${inner}<span class="own" hidden></span><span class="hs"></span></button>`;
  }).join('');
  b.insertAdjacentHTML('afterbegin', html);
  b.insertAdjacentHTML('beforeend', '<div class="tokens" id="tokens"></div>');
}
buildBoard();
$('#board').addEventListener('click', (e) => {
  const s = e.target.closest('[data-sq]');
  if (s && E.isOwnable(Number(s.dataset.sq))) openSheet('deed:' + s.dataset.sq);
  else if (s) openSheet('square:' + s.dataset.sq);
});

function renderBoardState(v) {
  const turnP = v.players.find((p) => p.uid === v.turn);
  for (const el of document.querySelectorAll('.sq')) {
    const i = Number(el.dataset.sq);
    const owner = v.owner[i];
    const own = el.querySelector('.own');
    own.hidden = !owner;
    if (owner) own.style.setProperty('--o', colorOf(v, owner));
    el.classList.toggle('mort', !!v.mortgaged[i]);
    el.classList.toggle('hl', !!(turnP && turnP.pos === i && v.phase === 'play' && v.step !== 'roll'));
    const h = v.houses[i] || 0;
    const hs = el.querySelector('.hs');
    const want = h === E.HOTEL ? '<i class="hotel"></i>' : '<i class="house"></i>'.repeat(h);
    if (hs.innerHTML !== want) hs.innerHTML = want;
  }
}
function renderTokens(v) {
  const byPos = {};
  const live = v.players.filter((p) => !p.out);
  for (const p of live) (byPos[ui.disp[p.uid]] = byPos[ui.disp[p.uid]] || []).push(p);
  const tk = $('#tokens');
  // Re-use pawn elements so position changes animate.
  const want = new Map();
  for (const p of live) want.set(p.uid, p);
  for (const el of [...tk.children]) if (!want.has(el.dataset.uid)) el.remove();
  for (const [pos, list] of Object.entries(byPos)) {
    const { r, c } = cellOf(Number(pos));
    const x0 = centerPct(c), y0 = centerPct(r);
    list.forEach((p, k) => {
      const n = list.length;
      const ang = (k / n) * Math.PI * 2 - Math.PI / 2;
      const rad = n > 1 ? 2.1 : 0;
      let el = tk.querySelector(`[data-uid="${CSS.escape(p.uid)}"]`);
      if (!el) { el = document.createElement('span'); el.dataset.uid = p.uid; el.textContent = p.name[0].toUpperCase(); tk.appendChild(el); }
      el.className = `pawn ${p.uid === v.me ? 'me' : ''} ${p.jail ? 'jailed' : ''}`;
      el.style.setProperty('--c', colorOf(v, p.uid));
      el.style.left = x0 + Math.cos(ang) * rad + '%';
      el.style.top = y0 + Math.sin(ang) * rad + '%';
      el.title = p.name;
    });
  }
}
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function dieHTML(n, spin, red) {
  const cells = [];
  for (let k = 1; k <= 9; k++) cells.push(PIPS[n].includes(k) ? '<i></i>' : '<span></span>');
  return `<div class="die ${spin ? 'spin' : ''} ${red ? 'red' : ''}" role="img" aria-label="${n}">${cells.join('')}</div>`;
}

// ---------- table ----------
function renderTable(v) {
  const meP = v.players.find((p) => p.uid === v.me);
  const turnP = v.players.find((p) => p.uid === v.turn);
  $('#bar-sub').textContent = v.phase === 'over' ? 'Game over' : `Round ${v.round}${v.settings.roundLimit ? ' of ' + v.settings.roundLimit : ''}${server.mode === 'cloud' ? ' · Table ' + v.id : ' · Practice'}`;
  renderBoardState(v);
  renderTokens(v);
  const d = v.dice || [];
  const dbl = d.length && d[0] === d[1];
  const dice = d.length ? dieHTML(d[0], ui.spin, dbl) + dieHTML(d[1], ui.spin, dbl) : dieHTML(1, false) + dieHTML(1, false);
  $('#dice').innerHTML = dice;
  $('#dice').style.opacity = d.length ? 1 : 0.35;
  ui.spin = false;
  let msg = '';
  if (v.phase === 'over') msg = `${esc(nameOf(v, v.winner))} ${v.winner === v.me ? 'win' : 'wins'}!`;
  else if (turnP) msg = turnP.uid === v.me ? 'Your turn' : `${esc(turnP.name)}'s turn`;
  if (v.phase === 'play' && v.log.length) msg += `<br><span style="font-weight:400;color:var(--muted)">${esc(v.log[v.log.length - 1])}</span>`;
  $('#center-msg').innerHTML = msg;
  renderActions(v, meP, turnP);
  renderPlayers(v);
  $('#log').innerHTML = v.log.slice().reverse().slice(0, 30).map((l) => `<li>${esc(l)}</li>`).join('');
}

function deedMini(i) {
  const sq = E.BOARD[i];
  const col = sq.kind === 'city' ? E.GROUPS[sq.g].color : '#8a7a68';
  return `<div class="deed-mini" style="--g:${col}"><span class="sw"></span><div><b>${esc(sq.name)}</b>${sq.kind === 'city' ? E.GROUPS[sq.g].name + ' · ' : ''}${R(sq.price)}</div></div>`;
}
function renderActions(v, meP, turnP) {
  const el = $('#actions');
  const mine = turnP && turnP.uid === v.me;
  const busy = ui.busy ? 'disabled' : '';
  const parts = [];
  if (meP && meP.auto && !meP.bot && !meP.out && v.phase === 'play') {
    parts.push(`<div class="banner">The computer is playing for you.<button class="btn slim green" data-a="takeback">Take over</button></div>`);
  }
  if (v.phase === 'over') {
    const host = v.hostUid === v.me;
    parts.push(`<h3>${esc(nameOf(v, v.winner))} ${v.winner === v.me ? 'win' : 'wins'} the game</h3>
      <div class="btns"><button class="btn" data-open="over">Final standings</button>${host ? `<button class="btn primary" data-a="rematch" ${busy}>Play again</button>` : ''}</div>`);
    el.innerHTML = parts.join('');
    return;
  }
  const debt = v.debts[0];
  const sub = `<div class="sub"><button class="btn" data-open="mine">My property</button><button class="btn" data-open="trade" ${meP && meP.out ? 'disabled' : ''}>Make a deal</button></div>`;
  if (meP && meP.out) {
    parts.push(`<h3>You're out</h3><p>You went bankrupt. You can keep watching.</p>`);
  } else if (debt) {
    const who = v.players.find((p) => p.uid === debt.uid);
    const to = debt.to === 'bank' ? 'the bank' : debt.to === 'each' ? 'the other players' : nameOf(v, debt.to);
    if (debt.uid === v.me) {
      const short = debt.amount - meP.cash;
      parts.push(`<h3>You owe ${R(debt.amount)} to ${esc(to)}</h3>
        <p>You have ${R(meP.cash)}. Sell buildings or mortgage property to raise ${R(short)} more. It pays automatically once you have it.</p>
        <div class="btns"><button class="btn primary" data-open="mine">Raise money</button><button class="btn danger" data-a="bankrupt" ${busy}>Declare bankruptcy</button></div>`);
    } else {
      parts.push(`<h3>${esc(who.name)} owes ${R(debt.amount)}</h3><p>Waiting for them to raise the money.</p>`);
    }
  } else if (v.step === 'auction' && v.auction) {
    const a = v.auction;
    const left = Math.max(0, a.endsAt - srvNow());
    const inIt = a.in.includes(v.me);
    const top = a.by ? `${nameOf(v, a.by)} ${a.by === v.me ? 'have' : 'has'} the top bid` : 'No bids yet';
    const steps = [100, 500, 1000].map((k) => a.high + k);
    parts.push(`<h3>Auction</h3>${deedMini(a.pos)}
      <div class="auction-top"><span>${esc(top)}</span><span class="amt">${R(a.high)}</span></div>
      <div class="timer"><i style="width:${Math.min(100, (left / 12000) * 100)}%"></i></div>
      ${inIt && a.by !== v.me ? `<div class="bidrow">${steps.map((n) => `<button class="btn ${n === steps[0] ? 'primary' : ''}" data-bid="${n}" ${busy || n > meP.cash ? 'disabled' : ''}>${R(n)}</button>`).join('')}</div>
      <button class="btn danger" data-a="fold" ${busy}>Drop out</button>` : `<p>${a.by === v.me ? "You're on top. Hold tight." : inIt ? '' : "You're out of this auction."}</p>`}`);
  } else if (mine) {
    if (v.step === 'roll' && meP.jail) {
      parts.push(`<h3>You're in Jail</h3><p>Roll a double to get out${meP.jail >= 3 ? '. This is your last try, after it you pay the fine and move' : `, or pay ${R(v.settings.jailFine)}`}.</p>
        <div class="btns"><button class="btn primary" data-a="roll" ${busy}>Roll for a double</button>
        <button class="btn" data-a="payJail" ${busy || meP.cash < v.settings.jailFine ? 'disabled' : ''}>Pay ${R(v.settings.jailFine)}</button>
        ${meP.jailCards ? `<button class="btn green" data-a="jailCard" ${busy}>Use free card</button>` : ''}</div>`);
    } else if (v.step === 'roll') {
      parts.push(`<h3>${v.dice && v.dice[0] === v.dice[1] ? 'Double! Roll again' : 'Your turn'}</h3>
        ${!meP.started ? '<p>You need to roll a 12 to leave Start.</p>' : ''}
        <button class="btn primary big" data-a="roll" ${busy}>Roll the dice</button>`);
    } else if (v.step === 'buy') {
      const sq = E.BOARD[meP.pos];
      const can = meP.cash >= sq.price;
      parts.push(`<h3>Buy ${esc(sq.name)}?</h3>${deedMini(meP.pos)}
        <p>You have ${R(meP.cash)}.${!can ? " Not enough cash. Mortgage something first, or pass." : ''}</p>
        <div class="btns"><button class="btn primary" data-a="buy" ${busy || !can ? 'disabled' : ''}>Buy for ${R(sq.price)}</button>
        <button class="btn" data-a="pass" ${busy}>${v.settings.auctions ? 'Pass (auction it)' : 'Pass'}</button></div>
        <button class="btn" data-open="deed:${meP.pos}" style="font-size:14px;padding:8px">See rents</button>`);
    } else if (v.step === 'after') {
      const again = v.rolledDoubles && !meP.jail;
      parts.push(`<h3>${again ? 'You rolled a double' : 'Anything else?'}</h3><p>Build, mortgage or make a deal now, then ${again ? 'roll again' : 'end your turn'}.</p>
        <button class="btn ${again ? 'primary' : 'green'} big" data-a="end" ${busy}>${again ? 'Roll again' : 'End turn'}</button>`);
    }
  } else if (turnP) {
    const doing = v.step === 'buy' ? `is deciding on ${E.BOARD[turnP.pos].name}` : v.step === 'after' ? 'is finishing their turn' : 'is about to roll';
    parts.push(`<h3>${esc(turnP.name)} ${esc(doing)}</h3>${computer(turnP) ? '' : '<p>You can still manage your property or make a deal.</p>'}`);
  }
  if (v.trade && !(meP && meP.out)) {
    const t = v.trade;
    if (t.from === v.me) parts.push(`<div class="banner">Waiting for ${esc(nameOf(v, t.to))} to answer your deal.<button class="btn slim" data-a="cancelTrade" ${busy}>Cancel</button></div>`);
    else if (t.to === v.me) parts.push(`<div class="banner">${esc(nameOf(v, t.from))} offered you a deal.<button class="btn slim primary" data-open="incoming">See it</button></div>`);
  }
  if (meP && !meP.out && v.phase === 'play') parts.push(sub);
  el.innerHTML = parts.join('');
}
$('#actions').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.open) return openSheet(b.dataset.open);
  if (b.dataset.bid) return act({ type: 'bid', amount: Number(b.dataset.bid) });
  const a = b.dataset.a;
  if (!a) return;
  if (a === 'bankrupt') {
    if (!confirm('Declare bankruptcy? You will be out of the game.')) return;
    return act({ type: 'bankrupt' });
  }
  if (a === 'takeback') return act({ type: 'autopilot', on: false });
  if (a === 'cancelTrade') return act({ type: 'tradeAnswer', yes: false });
  act({ type: a });
});
// The auction timer bar needs to tick between server updates.
setInterval(() => { if (view && view.phase === 'play' && view.step === 'auction') { const i = $('#actions .timer i'); if (i && view.auction) i.style.width = Math.min(100, Math.max(0, view.auction.endsAt - srvNow()) / 120) + '%'; } }, 300);

function renderPlayers(v) {
  const host = v.hostUid === v.me;
  $('#players').innerHTML = v.players.map((p) => {
    const away = !p.bot && !isOnline(p.uid);
    const tags = [];
    if (p.uid === v.me) tags.push('you');
    if (p.bot) tags.push('computer');
    else if (p.auto) tags.push('computer playing');
    else if (away) tags.push('away');
    if (p.jail) tags.push('in jail');
    if (p.jailCards) tags.push(`${p.jailCards} free card${p.jailCards > 1 ? 's' : ''}`);
    if (p.out) tags.push('bankrupt');
    const props = E.OWNABLE.filter((i) => v.owner[i] === p.uid).length;
    const canAuto = host && !p.bot && !p.auto && away && p.uid !== v.me && v.phase === 'play' && !p.out;
    return `<li class="${p.uid === v.turn && v.phase === 'play' ? 'turn' : ''} ${p.out ? 'out' : ''}">
      ${tokenHTML(v, p.uid)}
      <div class="who"><b>${esc(p.name)}</b><small>${props} propert${props === 1 ? 'y' : 'ies'}${tags.length ? ' · ' + esc(tags.join(' · ')) : ''}</small>
      ${canAuto ? `<div class="mini"><button class="btn slim" data-auto="${esc(p.uid)}">Let the computer play</button></div>` : ''}</div>
      <div class="money"><b>${p.out ? '-' : R(p.cash)}</b><small>${p.out ? '' : 'worth ' + R(p.worth)}</small></div>
    </li>`;
  }).join('');
}
$('#players').addEventListener('click', (e) => {
  const b = e.target.closest('[data-auto]');
  if (b) act({ type: 'autopilot', uid: b.dataset.auto, on: true });
});

// ---------- sheets ----------
const STATIC_SHEETS = new Set(['rules', 'trade', 'menu', 'square']);
function openSheet(name) {
  ui.sheet = name;
  if (name === 'trade') ui.draft = null;
  renderSheet();
}
function closeSheet() {
  ui.sheet = null;
  $('#sheet').hidden = true;
  $('#scrim').hidden = true;
}
$('#scrim').onclick = closeSheet;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b && !b.closest('#actions')) openSheet(b.dataset.open);
});
function autoSheets(v) {
  if (v.phase === 'over' && ui.overSeen !== v.id + v.winner) { ui.overSeen = v.id + v.winner; openSheet('over'); }
  const t = v.trade;
  const key = t ? `${t.from}-${t.at}` : '';
  if (t && t.to === v.me && ui.tradeSeen !== key) { ui.tradeSeen = key; openSheet('incoming'); }
  if (ui.sheet === 'incoming' && (!t || t.to !== v.me)) closeSheet();
}
const head = (title) => `<div class="sheet-head"><h2>${title}</h2><button class="close" data-close aria-label="Close">&times;</button></div>`;
function renderSheet() {
  if (!ui.sheet) return;
  const [kind, arg] = ui.sheet.split(':');
  const v = view;
  let html = '';
  if (kind === 'rules') html = rulesHTML();
  else if (!v) { closeSheet(); return; }
  else if (kind === 'menu') html = menuHTML(v);
  else if (kind === 'deed') html = deedHTML(v, Number(arg));
  else if (kind === 'square') html = squareHTML(v, Number(arg));
  else if (kind === 'mine') html = mineHTML(v);
  else if (kind === 'trade') html = tradeHTML(v);
  else if (kind === 'incoming') html = incomingHTML(v);
  else if (kind === 'over') html = overHTML(v);
  if (!html) { closeSheet(); return; }
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  $('#scrim').hidden = false;
}

function rulesHTML() {
  return `${head('How to play')}<div class="rules">
  <p>Roll two dice and move round the board. Land on a city, transport or utility nobody owns and you can buy it. Land on someone else's and you pay them rent. Last player with money wins.</p>
  <h3>Money</h3><ul>
    <li>Everyone starts with ₹15,000 (host can change it). Cross or land on Start to collect ₹1,500.</li>
    <li>By default you have to cross Start once before you can buy anything.</li></ul>
  <h3>Property</h3><ul>
    <li>Own all three cities of a colour and the rent on them doubles. Then you can build: up to 3 houses each, then a hotel. Build evenly across the colour, on your own turn.</li>
    <li>Transport rent goes up with each one you own (Roadways, Waterways, Airways, Railways). BEST Electric and Petroleum charge 40 times the dice, or 100 times if you own both.</li>
    <li>Pass on a property and it goes to auction. Anyone can bid. Bidding stops 8 seconds after the last bid, or when everyone else drops out.</li>
    <li>Mortgage a property to the bank for half its price. No rent while mortgaged. Lifting the mortgage costs the loan plus 10%. Sell buildings back for half what they cost.</li>
    <li>Make deals any time: swap property and cash with another player. Colours with buildings can't be traded.</li></ul>
  <h3>Special squares</h3><ul>
    <li><b>Club House:</b> pay ₹100 to each player. <b>Rest House:</b> collect ₹100 from each player. (Old style: Club ₹100 to the bank, Rest House miss a turn.)</li>
    <li><b>Income Tax:</b> ₹50 per property you own (min ₹100, max ₹500). <b>Wealth Tax:</b> ₹100 per house, ₹300 per hotel (min ₹100, max ₹1,000).</li>
    <li><b>Chance and Community Chest:</b> draw a card and do what it says.</li></ul>
  <h3>Doubles and Jail</h3><ul>
    <li>Roll a double and you go again. Three doubles in a row sends you to Jail.</li>
    <li>In Jail: pay the fine, use a free card, or try for a double for up to three turns. After the third miss you pay and move. You still collect rent in Jail.</li></ul>
  <h3>Going broke</h3><ul>
    <li>If you owe more than you have, the game waits while you sell buildings and mortgage. Can't cover it? You're bankrupt: everything goes to whoever you owed (or back to the bank).</li></ul>
  </div>`;
}
function menuHTML(v) {
  const cloud = server.mode === 'cloud';
  const host = v.hostUid === v.me;
  const hostP = v.players.find((p) => p.uid === v.hostUid);
  const hostGone = cloud && !host && (!hostP || hostP.left || !isOnline(v.hostUid));
  return `${head('Menu')}
    ${cloud ? `<p class="muted">Table code <b style="color:var(--ink);letter-spacing:.1em">${esc(v.id)}</b></p><button class="btn" data-m="invite">Copy invite link</button>` : ''}
    <button class="btn" data-open="rules">How to play</button>
    ${hostGone ? '<button class="btn" data-m="claim">Become the host</button>' : ''}
    <button class="btn danger" data-m="leave">Leave the table</button>`;
}
function deedHTML(v, i) {
  const sq = E.BOARD[i];
  if (!sq || !E.isOwnable(i)) return '';
  const owner = v.owner[i];
  const col = sq.kind === 'city' ? E.GROUPS[sq.g].color : '#4b3a2c';
  const light = sq.kind === 'city' && LIGHT.has(sq.g);
  const h = v.houses[i] || 0;
  let rows = '';
  if (sq.kind === 'city') {
    const full = owner && E.ownsGroup(v, owner, sq.g);
    const labels = ['Site rent', 'With 1 house', 'With 2 houses', 'With 3 houses', 'With a hotel'];
    rows = sq.rent.map((r, k) => `<tr class="${owner && !v.mortgaged[i] && k === h ? 'now' : ''}"><td>${labels[k]}</td><td>${R(r)}</td></tr>`).join('')
      + `<tr class="${owner && full && !h && !v.mortgaged[i] ? 'now' : ''}"><td>Site rent with the full colour</td><td>${R(sq.rent[0] * 2)}</td></tr>`
      + `<tr><td>Each house or hotel costs</td><td>${R(E.BUILD[sq.g])}</td></tr>`;
  } else if (sq.kind === 'transport') {
    rows = [1, 2, 3, 4].map((n) => `<tr><td>Own ${n} transport${n > 1 ? 's' : ''}</td><td>${R(sq.base * n)}</td></tr>`).join('');
  } else {
    rows = `<tr><td>Own one utility</td><td>40 × dice</td></tr><tr><td>Own both</td><td>100 × dice</td></tr>`;
  }
  rows += `<tr><td>Mortgage value</td><td>${R(E.mortgageValue(i))}</td></tr>`;
  const status = owner ? `Owned by ${esc(nameOf(v, owner))}${v.mortgaged[i] ? ' · mortgaged' : ''}${h ? ' · ' + (h === E.HOTEL ? 'hotel' : h + ' house' + (h > 1 ? 's' : '')) : ''}` : 'Owned by the bank';
  let actions = '';
  if (owner === v.me && v.phase === 'play') actions = `<div class="deed-actions">${propButtons(v, i)}</div>`;
  return `${head('')}
    <div class="deed"><div class="deed-head ${light ? 'light' : ''}" style="--g:${col};background:${col}"><small>${sq.kind === 'city' ? esc(E.GROUPS[sq.g].name) : sq.kind === 'transport' ? 'Transport' : 'Utility'}</small><b>${ICON[sq.name] ? ICON[sq.name] + ' ' : ''}${esc(sq.name)}</b></div>
    <table>${`<tr><td>Price</td><td>${R(sq.price)}</td></tr>` + rows}</table>
    <div class="foot">${status}</div></div>${actions}`;
}
function squareHTML(v, i) {
  const sq = E.BOARD[i];
  const s = v.settings;
  const text = {
    start: `Collect ${R(s.salary)} every time you land on or cross Start.`,
    jail: `Just visiting if you land here. Sent to Jail? Pay ${R(s.jailFine)}, use a free card, or roll for a double.`,
    club: s.clubRest === 'money' ? 'Pay ₹100 to each other player.' : 'Pay ₹100 to the bank.',
    rest: s.clubRest === 'money' ? 'Collect ₹100 from each other player.' : 'Take a rest and miss your next turn.',
    chance: 'Draw a Chance card and do what it says.',
    chest: 'Draw a Community Chest card and do what it says.',
    tax: sq.tax === 'income' ? 'Pay ₹50 for every property you own. Minimum ₹100, maximum ₹500.' : 'Pay ₹100 per house and ₹300 per hotel. Minimum ₹100, maximum ₹1,000.',
  }[sq.kind] || '';
  return `${head(esc(sq.name))}<p>${text}</p>`;
}
function propButtons(v, i) {
  const me = v.me;
  const sq = E.BOARD[i];
  const myTurn = v.turn === me;
  const inDebt = v.debts.length && v.debts[0].uid === me;
  const out = [];
  const b = (a, label, why, cls = '') => `<button class="btn ${cls}" data-p="${a}" data-sq="${i}" ${why || ui.busy ? 'disabled' : ''} title="${esc(why)}">${label}</button>`;
  if (sq.kind === 'city') {
    const h = v.houses[i] || 0;
    if (E.ownsGroup(v, me, sq.g) && !v.mortgaged[i]) {
      if (h < E.HOTEL) {
        let why = E.canBuild(v, me, i);
        if (!why && !myTurn) why = 'Build on your own turn.';
        if (!why && v.debts.length) why = 'Settle debts first.';
        out.push(b('build', `${h === 3 ? 'Build hotel' : 'Build house'} ${R(E.BUILD[sq.g])}`, why, 'green'));
      }
      if (h) out.push(b('sell', `Sell ${h === E.HOTEL ? 'hotel' : 'house'} +${R(E.BUILD[sq.g] / 2)}`, E.canSellHouse(v, me, i) || (!myTurn && !inDebt ? 'Only on your turn or when you owe money.' : '')));
    }
  }
  if (v.mortgaged[i]) {
    let why = E.canUnmortgage(v, me, i);
    if (!why && !myTurn) why = 'Lift mortgages on your own turn.';
    out.push(b('unmortgage', `Lift mortgage ${R(E.unmortgageCost(i))}`, why));
  } else {
    out.push(b('mortgage', `Mortgage +${R(E.mortgageValue(i))}`, E.canMortgage(v, me, i) || (!myTurn && !inDebt ? 'Only on your turn or when you owe money.' : '')));
  }
  return out.join('');
}
function mineHTML(v) {
  const me = v.players.find((p) => p.uid === v.me);
  const props = E.OWNABLE.filter((i) => v.owner[i] === v.me);
  const debt = v.debts[0] && v.debts[0].uid === v.me ? v.debts[0] : null;
  const top = debt ? `<div class="banner">You owe ${R(debt.amount)} and have ${R(me.cash)}. Raise ${R(Math.max(0, debt.amount - me.cash))} more.</div>` : `<p class="muted">Cash ${R(me ? me.cash : 0)}${me && me.jailCards ? ` · ${me.jailCards} Get out of Jail free card${me.jailCards > 1 ? 's' : ''}` : ''}</p>`;
  if (!props.length) return `${head('My property')}${top}<p class="empty">You don't own anything yet.</p>`;
  const list = props.map((i) => {
    const sq = E.BOARD[i];
    const col = sq.kind === 'city' ? E.GROUPS[sq.g].color : '#8a7a68';
    const h = v.houses[i] || 0;
    const info = [sq.kind === 'city' ? (E.ownsGroup(v, v.me, sq.g) ? 'Full colour' : E.GROUPS[sq.g].name) : sq.kind === 'transport' ? 'Transport' : 'Utility',
      h ? (h === E.HOTEL ? 'Hotel' : `${h} house${h > 1 ? 's' : ''}`) : '', v.mortgaged[i] ? 'Mortgaged' : `Rent ${R(E.rentFor(v, i, 7))}${sq.kind === 'utility' ? ' on a 7' : ''}`].filter(Boolean).join(' · ');
    return `<li class="prop ${v.mortgaged[i] ? 'mort' : ''}" style="--g:${col}"><span class="sw"></span><div><b>${esc(sq.name)}</b><small>${esc(info)}</small></div><div class="pb">${propButtons(v, i)}</div></li>`;
  }).join('');
  return `${head('My property')}${top}<ul class="plist2">${list}</ul>`;
}
$('#sheet').addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]')) return closeSheet();
  const pb = e.target.closest('[data-p]');
  if (pb) { await act({ type: pb.dataset.p, sq: Number(pb.dataset.sq) }); return; }
  const m = e.target.closest('[data-m]');
  if (m) {
    if (m.dataset.m === 'invite') copyInvite();
    if (m.dataset.m === 'leave') { closeSheet(); leaveTable(); }
    if (m.dataset.m === 'claim') { await act({ type: 'claimHost' }); closeSheet(); }
    if (m.dataset.m === 'rematch') { await act({ type: 'rematch' }); closeSheet(); }
    if (m.dataset.m === 'accept') { await act({ type: 'tradeAnswer', yes: true }); }
    if (m.dataset.m === 'decline') { await act({ type: 'tradeAnswer', yes: false }); closeSheet(); }
    if (m.dataset.m === 'send') sendTrade();
    return;
  }
  const who = e.target.closest('[data-with]');
  if (who) { ui.draft = { to: who.dataset.with, give: [], get: [], giveCash: 0, getCash: 0 }; renderSheet(); }
});

// ---------- deals ----------
const tradable = (v, i) => !(E.BOARD[i].kind === 'city' && E.groupSquares(E.BOARD[i].g).some((j) => v.houses[j]));
function tradeHTML(v) {
  const others = v.players.filter((p) => p.uid !== v.me && !p.out);
  if (!others.length) return `${head('Make a deal')}<p class="empty">Nobody left to deal with.</p>`;
  if (v.trade) return `${head('Make a deal')}<p class="muted">Another deal is waiting for an answer. Try again once it's settled.</p>`;
  const d = ui.draft;
  const chips = `<div class="chips">${others.map((p) => `<button class="chip ${d && d.to === p.uid ? 'on' : ''}" data-with="${esc(p.uid)}">${tokenHTML(v, p.uid)}${esc(p.name)}</button>`).join('')}</div>`;
  if (!d) return `${head('Make a deal')}<p class="muted">Who do you want to deal with?</p>${chips}`;
  const them = v.players.find((p) => p.uid === d.to);
  const me = v.players.find((p) => p.uid === v.me);
  const col = (uid, key) => {
    const list = E.OWNABLE.filter((i) => v.owner[i] === uid);
    if (!list.length) return '<p class="empty">Nothing</p>';
    return list.map((i) => {
      const sq = E.BOARD[i];
      const ok = tradable(v, i);
      const c = sq.kind === 'city' ? E.GROUPS[sq.g].color : '#8a7a68';
      return `<label class="chk ${ok ? '' : 'dis'}" style="--g:${c}"><input type="checkbox" data-t="${key}" value="${i}" ${d[key].includes(i) ? 'checked' : ''} ${ok ? '' : 'disabled'}><span class="sw"></span><span>${esc(sq.name)}${v.mortgaged[i] ? ' (mortgaged)' : ''}</span></label>`;
    }).join('');
  };
  return `${head('Make a deal')}${chips}
    <div class="trade-cols">
      <div class="trade-col"><h4>You give</h4>${col(v.me, 'give')}<label class="field"><span style="color:var(--muted)">Cash (you have ${R(me.cash)})</span><input type="number" min="0" step="50" inputmode="numeric" data-c="giveCash" value="${d.giveCash || ''}" placeholder="₹0"></label></div>
      <div class="trade-col"><h4>${esc(them.name)} gives</h4>${col(d.to, 'get')}<label class="field"><span style="color:var(--muted)">Cash (they have ${R(them.cash)})</span><input type="number" min="0" step="50" inputmode="numeric" data-c="getCash" value="${d.getCash || ''}" placeholder="₹0"></label></div>
    </div>
    <p class="muted" style="font-size:13px">Colours with buildings can't be traded. Only one side pays cash.</p>
    <button class="btn primary big" data-m="send">Send the offer</button>`;
}
$('#sheet').addEventListener('change', (e) => {
  const d = ui.draft;
  if (!d) return;
  const t = e.target;
  if (t.dataset.t) {
    const i = Number(t.value);
    d[t.dataset.t] = t.checked ? [...d[t.dataset.t], i] : d[t.dataset.t].filter((x) => x !== i);
  }
  if (t.dataset.c) d[t.dataset.c] = Math.max(0, Math.floor(Number(t.value) || 0));
});
$('#sheet').addEventListener('input', (e) => {
  const d = ui.draft;
  const t = e.target;
  if (d && t.dataset.c) d[t.dataset.c] = Math.max(0, Math.floor(Number(t.value) || 0));
});
async function sendTrade() {
  const d = ui.draft;
  if (!d) return;
  if (await act({ type: 'trade', to: d.to, give: d.give, get: d.get, giveCash: d.giveCash, getCash: d.getCash })) {
    toast('Offer sent.');
    closeSheet();
  }
}
function dealList(v, props, cash) {
  const items = props.map((i) => esc(E.BOARD[i].name) + (v.mortgaged[i] ? ' (mortgaged)' : ''));
  if (cash) items.push(R(cash));
  return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted">Nothing</p>';
}
function incomingHTML(v) {
  const t = v.trade;
  if (!t || t.to !== v.me) return '';
  const from = nameOf(v, t.from);
  return `${head('A deal for you')}<p><b>${esc(from)}</b> wants to trade.</p>
    <div class="deal-sum"><div><b>You get</b>${dealList(v, t.give, t.giveCash)}</div><div><b>You give</b>${dealList(v, t.get, t.getCash)}</div></div>
    <div class="btns" style="display:flex;gap:8px"><button class="btn danger" style="flex:1" data-m="decline" ${ui.busy ? 'disabled' : ''}>No thanks</button><button class="btn green" style="flex:2" data-m="accept" ${ui.busy ? 'disabled' : ''}>Accept the deal</button></div>
    <p class="muted" style="font-size:13px">Offers expire after a minute.</p>`;
}
function overHTML(v) {
  if (v.phase !== 'over') return '';
  const host = v.hostUid === v.me;
  const rows = (v.ranking || []).map((r, k) => {
    const p = v.players.find((x) => x.uid === r.uid);
    return `<li><span>${k + 1}</span>${tokenHTML(v, r.uid)}<span>${esc(p ? p.name : '')}${r.uid === v.me ? ' (you)' : ''}</span><span>${r.worth < 0 ? 'Bankrupt' : R(r.worth)}</span></li>`;
  }).join('');
  return `${head(`${esc(nameOf(v, v.winner))} ${v.winner === v.me ? 'win' : 'wins'}!`)}
    <p class="muted">Final standings by net worth (cash, property and buildings).</p>
    <ol class="rank">${rows}</ol>
    ${host ? '<button class="btn primary big" data-m="rematch">Play again</button>' : '<p class="muted">The host can start another game.</p>'}
    <button class="btn" data-m="leave">Leave the table</button>`;
}

// ---------- start up ----------
render();
const back = store.get('table', null);
if (params.get('t') && store.get('name', '')) joinCode(params.get('t'), true);
else if (back && !params.get('t') && store.get('name', '')) joinCode(back, true);
