// Business Deal rules engine (the classic Indian property trading board game).
// The same file runs in two places:
//   functions/engine.js  the Firebase server, which runs every online table
//   docs/engine.js       the browser, only for practice games against computer players
// Keep the two copies identical (npm run sync).

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// Every rule a host can change.
export const DEFAULT_SETTINGS = {
  startCash: 15000,     // money each player starts with
  salary: 1500,         // paid every time you land on or pass Start
  lapFirst: true,       // you must cross Start once before you can buy anything
  auctions: true,       // a property nobody buys goes to auction
  clubRest: 'money',    // 'money': Club House pay 100 to each player, Rest House collect 100 from each
                        // 'old':   Club House pay 100 to the bank, Rest House miss your next turn
  jailFine: 500,
  roll12: false,        // old rule: you can't leave Start until you roll a 12
  roundLimit: 0,        // 0 = play until one player is left. Otherwise richest after this many rounds wins
};

// ---------- the board ----------
// 36 squares. 6 colour groups of 3 cities, 4 transport, 2 utilities, 3 Chance, 3 Community Chest, 2 taxes, 4 corners.
// rent: [site, 1 house, 2 houses, 3 houses, hotel]
export const GROUPS = {
  1: { name: 'Hill Stations', color: '#5ab4e5' },
  2: { name: 'Rajasthan & Punjab', color: '#d94f8c' },
  3: { name: 'Central India', color: '#ef8a24' },
  4: { name: 'Coast', color: '#d6332a' },
  5: { name: 'South & Kashmir', color: '#e9c21d' },
  6: { name: 'Metros', color: '#1f8a4c' },
};
export const BUILD = { 1: 1500, 2: 2000, 3: 2500, 4: 3000, 5: 3500, 6: 4500 };
const C = (name, g, price, rent) => ({ kind: 'city', name, g, price, rent });
export const BOARD = [
  { kind: 'start', name: 'Start' },
  C('Shimla', 1, 2200, [180, 1000, 2200, 3000, 4500]),
  { kind: 'chest', name: 'Community Chest' },
  C('Ooty', 1, 2400, [190, 1100, 2400, 3200, 4800]),
  C('Darjeeling', 1, 2500, [200, 1200, 2600, 3500, 5000]),
  { kind: 'transport', name: 'Roadways', price: 4500, base: 450 },
  C('Jaipur', 2, 3000, [250, 1500, 3000, 4200, 6000]),
  { kind: 'chance', name: 'Chance' },
  C('Agra', 2, 3200, [280, 1600, 3200, 4500, 6400]),
  { kind: 'jail', name: 'Jail' },
  C('Amritsar', 2, 3300, [300, 1700, 3400, 4700, 6600]),
  { kind: 'utility', name: 'BEST Electric', price: 4000 },
  C('Lucknow', 3, 3800, [350, 2000, 4000, 5500, 7500]),
  C('Indore', 3, 3900, [370, 2100, 4200, 5700, 7800]),
  { kind: 'transport', name: 'Waterways', price: 6000, base: 600 },
  { kind: 'chest', name: 'Community Chest' },
  C('Bhopal', 3, 4200, [400, 2300, 4500, 6000, 8200]),
  C('Goa', 4, 4500, [450, 2500, 5000, 6500, 8500]),
  { kind: 'club', name: 'Club House' },
  { kind: 'chance', name: 'Chance' },
  C('Kochi', 4, 4600, [460, 2600, 5100, 6700, 8800]),
  C('Pune', 4, 4800, [480, 2800, 5400, 7000, 9200]),
  { kind: 'tax', name: 'Income Tax', tax: 'income' },
  { kind: 'transport', name: 'Airways', price: 8000, base: 850 },
  C('Srinagar', 5, 5000, [550, 3000, 5500, 7500, 10000]),
  C('Hyderabad', 5, 5500, [600, 3200, 6000, 8000, 10500]),
  C('Bengaluru', 5, 6000, [650, 3500, 6500, 8500, 11000]),
  { kind: 'rest', name: 'Rest House' },
  C('Kolkata', 6, 7000, [800, 4000, 8000, 10500, 13000]),
  { kind: 'chest', name: 'Community Chest' },
  C('Delhi', 6, 8000, [1000, 4500, 9000, 12000, 15000]),
  { kind: 'utility', name: 'Petroleum', price: 5000 },
  { kind: 'transport', name: 'Railways', price: 9500, base: 1000 },
  { kind: 'chance', name: 'Chance' },
  { kind: 'tax', name: 'Wealth Tax', tax: 'wealth' },
  C('Mumbai', 6, 8500, [1200, 5000, 10000, 13500, 17000]),
];
export const N = BOARD.length; // 36
export const JAIL = 9;
export const isOwnable = (i) => ['city', 'transport', 'utility'].includes(BOARD[i].kind);
export const OWNABLE = BOARD.map((_, i) => i).filter(isOwnable);
export const groupSquares = (g) => OWNABLE.filter((i) => BOARD[i].g === g);
export const mortgageValue = (i) => Math.floor(BOARD[i].price / 2);
export const unmortgageCost = (i) => Math.ceil((mortgageValue(i) * 1.1) / 10) * 10;
export const HOTEL = 4; // houses value 4 means a hotel
export const UTIL_MULT = [40, 100]; // utility rent is dice total times this (one owned, both owned)

// ---------- cards ----------
// Each card: text plus an effect. Kept short so they read well on a phone.
export const CHANCE = [
  { t: 'You won a lottery. Collect ₹2,500.', e: ['get', 2500] },
  { t: 'Go to Jail. Go straight there, do not pass Start.', e: ['jail'] },
  { t: 'Advance to Start.', e: ['goto', 0] },
  { t: 'Go to Mumbai.', e: ['goto', 35] },
  { t: 'Go to Delhi.', e: ['goto', 30] },
  { t: 'Take a trip on the Railways.', e: ['goto', 32] },
  { t: 'Go back 3 spaces.', e: ['back', 3] },
  { t: 'Speeding fine. Pay ₹300.', e: ['pay', 300] },
  { t: 'Your shares paid a dividend. Collect ₹1,000.', e: ['get', 1000] },
  { t: 'Repairs on all your property. Pay ₹250 per house and ₹1,000 per hotel.', e: ['repairs', 250, 1000] },
  { t: 'You were elected chairman. Pay each player ₹200.', e: ['payEach', 200] },
  { t: 'Get out of Jail free. Keep this card until you need it.', e: ['jailFree'] },
  { t: 'Crossword prize. Collect ₹500.', e: ['get', 500] },
  { t: 'Go to the Club House.', e: ['goto', 18] },
];
export const CHEST = [
  { t: 'Bank error in your favour. Collect ₹2,000.', e: ['get', 2000] },
  { t: "It's your birthday. Collect ₹200 from each player.", e: ['getEach', 200] },
  { t: "Doctor's fee. Pay ₹500.", e: ['pay', 500] },
  { t: 'School fees. Pay ₹750.', e: ['pay', 750] },
  { t: 'Income tax refund. Collect ₹200.', e: ['get', 200] },
  { t: 'Go to Jail. Go straight there, do not pass Start.', e: ['jail'] },
  { t: 'Advance to Start.', e: ['goto', 0] },
  { t: 'Get out of Jail free. Keep this card until you need it.', e: ['jailFree'] },
  { t: 'You inherit ₹1,000.', e: ['get', 1000] },
  { t: 'Sale of stock. Collect ₹450.', e: ['get', 450] },
  { t: 'Insurance premium due. Pay ₹500.', e: ['pay', 500] },
  { t: 'Property tax. Pay ₹400 per house and ₹1,150 per hotel.', e: ['repairs', 400, 1150] },
  { t: "Cousin's wedding. Pay ₹1,000 for the gift.", e: ['pay', 1000] },
  { t: 'Diwali bonus. Collect ₹1,000.', e: ['get', 1000] },
];

// ---------- randomness ----------
function randInt(n) {
  const buf = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  let x;
  do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % n;
}
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function makeCode(len = 5) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += A[randInt(A.length)];
  return s;
}
const die = () => randInt(6) + 1;
export const rupees = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

// ---------- table setup ----------
function cleanName(name) {
  const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  if (!n) throw new Error('Put your name in first.');
  return n;
}
function newPlayer(uid, name, bot) {
  return { uid, name, bot, auto: false, left: false, out: false, cash: 0, pos: 0, jail: 0, jailCards: [], doubles: 0, passed: false, started: true, skip: 0 };
}
export function createTable(id, uid, name) {
  return {
    id,
    hostUid: uid,
    phase: 'lobby',
    seq: 0,
    moveNo: 0,
    settings: { ...DEFAULT_SETTINGS },
    players: [newPlayer(uid, cleanName(name), false)],
    owner: {},      // square -> uid
    houses: {},     // square -> 0..4 (4 = hotel)
    mortgaged: {},  // square -> true
    decks: { chance: [], chest: [] },
    turn: 0,
    step: 'roll',   // roll | buy | auction | after
    dice: null,
    rolledDoubles: false,
    auction: null,
    debts: [],      // [{ uid, to, amount, why }] to = uid, 'bank' or 'each'
    trade: null,
    card: null,     // last card drawn, for display
    round: 1,
    log: [],
    winner: null,
    ranking: null,
    rids: {},
    botAt: 0,
    lastActive: 0,
  };
}

const idxOf = (st, uid) => st.players.findIndex((p) => p.uid === uid);
const playerOf = (st, uid) => st.players.find((p) => p.uid === uid);
const isHost = (st, uid) => st.hostUid === uid;
const computerRuns = (p) => p.bot || p.auto;
const active = (st) => st.players.filter((p) => !p.out);
const cur = (st) => st.players[st.turn];
function need(cond, msg) { if (!cond) throw new Error(msg); }
function log(st, msg) {
  st.log.push(msg);
  if (st.log.length > 60) st.log.splice(0, st.log.length - 60);
}

export function joinTable(st, uid, name) {
  if (idxOf(st, uid) >= 0) {
    const p = playerOf(st, uid);
    if (p.left) { p.left = false; p.auto = false; st.seq++; }
    return;
  }
  need(st.phase === 'lobby', 'This game already started. You can join when the host starts a rematch.');
  need(st.players.length < MAX_PLAYERS, `Table is full (${MAX_PLAYERS} players).`);
  st.players.push(newPlayer(uid, cleanName(name), false));
  st.seq++;
}

const BOT_NAMES = ['Seth Ji', 'Munim', 'Lala', 'Bunty', 'Pinky', 'Golu', 'Sweety'];
function addBot(st) {
  need(st.players.length < MAX_PLAYERS, `Table is full (${MAX_PLAYERS} players).`);
  const used = new Set(st.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (st.players.length + 1);
  let uid;
  do { uid = 'bot_' + makeCode(6); } while (idxOf(st, uid) >= 0);
  st.players.push(newPlayer(uid, name, true));
}

function applySettings(st, s) {
  const d = st.settings;
  const pick = (v, ok, dflt) => (ok.includes(v) ? v : dflt);
  if ('startCash' in s) d.startCash = pick(Number(s.startCash), [10000, 15000, 20000, 25000], d.startCash);
  if ('salary' in s) d.salary = pick(Number(s.salary), [1000, 1500, 2000], d.salary);
  if ('lapFirst' in s) d.lapFirst = !!s.lapFirst;
  if ('auctions' in s) d.auctions = !!s.auctions;
  if ('clubRest' in s) d.clubRest = pick(s.clubRest, ['money', 'old'], d.clubRest);
  if ('jailFine' in s) d.jailFine = pick(Number(s.jailFine), [200, 500, 1000], d.jailFine);
  if ('roll12' in s) d.roll12 = !!s.roll12;
  if ('roundLimit' in s) d.roundLimit = pick(Number(s.roundLimit), [0, 15, 20, 30, 40], d.roundLimit);
}

function startGame(st) {
  need(st.players.length >= MIN_PLAYERS, `Need at least ${MIN_PLAYERS} players. Add a computer player or wait for a friend.`);
  shuffle(st.players);
  for (const p of st.players) Object.assign(p, newPlayer(p.uid, p.name, p.bot), { auto: p.auto, left: p.left, cash: st.settings.startCash, started: !st.settings.roll12 });
  Object.assign(st, {
    phase: 'play', owner: {}, houses: {}, mortgaged: {}, turn: 0, step: 'roll', dice: null, rolledDoubles: false,
    auction: null, debts: [], trade: null, card: null, round: 1, log: [], winner: null, ranking: null,
    decks: { chance: shuffle(CHANCE.map((_, i) => i)), chest: shuffle(CHEST.map((_, i) => i)) },
  });
  st.moveNo++;
  log(st, `Game on. ${cur(st).name} goes first. Everyone starts with ${rupees(st.settings.startCash)}.`);
}

// ---------- money ----------
export function netWorth(st, uid) {
  const p = playerOf(st, uid);
  let w = p.cash;
  for (const i of OWNABLE) {
    if (st.owner[i] !== uid) continue;
    w += st.mortgaged[i] ? BOARD[i].price - mortgageValue(i) : BOARD[i].price;
    const h = st.houses[i] || 0;
    if (h) w += h * BUILD[BOARD[i].g];
  }
  return w;
}
function give(st, uid, amount) { playerOf(st, uid).cash += amount; }

// Take money from uid. If they can't cover it, it becomes a debt they have to raise money for.
function charge(st, uid, amount, to, why) {
  if (amount <= 0) return;
  const p = playerOf(st, uid);
  if (p.cash >= amount && !st.debts.some((d) => d.uid === uid)) {
    p.cash -= amount;
    payOut(st, uid, to, amount);
  } else {
    st.debts.push({ uid, to, amount, why });
    log(st, `${p.name} owes ${rupees(amount)} (${why}) and has to raise the money.`);
  }
}
function payOut(st, from, to, amount) {
  if (to === 'bank') return;
  if (to === 'each') {
    const others = active(st).filter((q) => q.uid !== from);
    const share = others.length ? Math.floor(amount / others.length) : 0;
    for (const q of others) q.cash += share;
    return;
  }
  const q = playerOf(st, to);
  if (q) q.cash += amount;
}
// Settle the first debt in line if the debtor has the cash now.
function settleDebts(st) {
  while (st.debts.length) {
    const d = st.debts[0];
    const p = playerOf(st, d.uid);
    if (p.out) { st.debts.shift(); continue; }
    if (p.cash < d.amount) return;
    p.cash -= d.amount;
    payOut(st, d.uid, d.to, d.amount);
    st.debts.shift();
    log(st, `${p.name} paid the ${rupees(d.amount)} they owed.`);
  }
}
export function raisable(st, uid) {
  // Cash a player could raise right now by selling every building and mortgaging everything.
  let r = 0;
  for (const i of OWNABLE) {
    if (st.owner[i] !== uid) continue;
    const h = st.houses[i] || 0;
    r += Math.floor((h * BUILD[BOARD[i].g]) / 2);
    if (!st.mortgaged[i]) r += mortgageValue(i);
  }
  return r;
}

// ---------- property rules ----------
export const ownsGroup = (st, uid, g) => groupSquares(g).every((i) => st.owner[i] === uid);
export function rentFor(st, i, diceTotal) {
  const sq = BOARD[i];
  const owner = st.owner[i];
  if (!owner || st.mortgaged[i]) return 0;
  if (sq.kind === 'city') {
    const h = st.houses[i] || 0;
    if (h) return sq.rent[h];
    return ownsGroup(st, owner, sq.g) ? sq.rent[0] * 2 : sq.rent[0];
  }
  if (sq.kind === 'transport') {
    const n = OWNABLE.filter((j) => BOARD[j].kind === 'transport' && st.owner[j] === owner && !st.mortgaged[j]).length;
    return sq.base * Math.max(1, n);
  }
  if (sq.kind === 'utility') {
    const n = OWNABLE.filter((j) => BOARD[j].kind === 'utility' && st.owner[j] === owner && !st.mortgaged[j]).length;
    return (diceTotal || 7) * UTIL_MULT[Math.max(0, n - 1)];
  }
  return 0;
}
export function canBuild(st, uid, i) {
  const sq = BOARD[i];
  if (sq.kind !== 'city' || st.owner[i] !== uid) return 'Not yours.';
  if (!ownsGroup(st, uid, sq.g)) return `You need all three ${GROUPS[sq.g].name} cities to build.`;
  const g = groupSquares(sq.g);
  if (g.some((j) => st.mortgaged[j])) return 'Lift the mortgages in this colour first.';
  const h = st.houses[i] || 0;
  if (h >= HOTEL) return 'Already has a hotel.';
  const min = Math.min(...g.map((j) => st.houses[j] || 0));
  if (h > min) return 'Build evenly. Put a house on the other cities in this colour first.';
  if (playerOf(st, uid).cash < BUILD[sq.g]) return `Building costs ${rupees(BUILD[sq.g])}.`;
  return '';
}
export function canSellHouse(st, uid, i) {
  const sq = BOARD[i];
  if (sq.kind !== 'city' || st.owner[i] !== uid) return 'Not yours.';
  const h = st.houses[i] || 0;
  if (!h) return 'Nothing built here.';
  const max = Math.max(...groupSquares(sq.g).map((j) => st.houses[j] || 0));
  if (h < max) return 'Sell evenly. Sell from the city with the most buildings first.';
  return '';
}
export function canMortgage(st, uid, i) {
  if (st.owner[i] !== uid) return 'Not yours.';
  if (st.mortgaged[i]) return 'Already mortgaged.';
  const sq = BOARD[i];
  if (sq.kind === 'city' && groupSquares(sq.g).some((j) => st.houses[j])) return 'Sell the buildings in this colour first.';
  return '';
}
export function canUnmortgage(st, uid, i) {
  if (st.owner[i] !== uid) return 'Not yours.';
  if (!st.mortgaged[i]) return 'Not mortgaged.';
  if (playerOf(st, uid).cash < unmortgageCost(i)) return `Lifting the mortgage costs ${rupees(unmortgageCost(i))}.`;
  return '';
}

// ---------- moving ----------
function moveTo(st, p, dest, passSalary = true) {
  if (passSalary && dest < p.pos) collectSalary(st, p);
  p.pos = dest;
}
function collectSalary(st, p) {
  p.cash += st.settings.salary;
  p.passed = true;
  log(st, `${p.name} crossed Start and collected ${rupees(st.settings.salary)}.`);
}
function sendToJail(st, p) {
  p.pos = JAIL;
  p.jail = 1;
  p.doubles = 0;
  st.rolledDoubles = false;
  log(st, `${p.name} went to Jail.`);
}

function land(st, p) {
  const i = p.pos;
  const sq = BOARD[i];
  const s = st.settings;
  switch (sq.kind) {
    case 'start':
      // Landing exactly on Start pays the same salary as passing it; moveTo already paid it.
      break;
    case 'jail':
      log(st, `${p.name} is just visiting Jail.`);
      break;
    case 'club':
      if (s.clubRest === 'money') {
        const others = active(st).filter((q) => q.uid !== p.uid);
        log(st, `${p.name} is at the Club House and pays ₹100 to each player.`);
        for (const q of others) charge(st, p.uid, 100, q.uid, 'Club House');
      } else {
        log(st, `${p.name} pays ₹100 at the Club House.`);
        charge(st, p.uid, 100, 'bank', 'Club House');
      }
      break;
    case 'rest':
      if (s.clubRest === 'money') {
        log(st, `${p.name} is at the Rest House and collects ₹100 from each player.`);
        for (const q of active(st)) if (q.uid !== p.uid) charge(st, q.uid, 100, p.uid, 'Rest House');
      } else {
        p.skip = 1;
        log(st, `${p.name} rests and misses the next turn.`);
      }
      break;
    case 'tax': {
      let amt;
      if (sq.tax === 'income') {
        const n = OWNABLE.filter((j) => st.owner[j] === p.uid).length;
        amt = Math.min(500, Math.max(100, n * 50));
        log(st, `Income Tax: ${p.name} pays ${rupees(amt)} (₹50 per property, min ₹100, max ₹500).`);
      } else {
        let h = 0, hotels = 0;
        for (const j of OWNABLE) if (st.owner[j] === p.uid) { const k = st.houses[j] || 0; if (k === HOTEL) hotels++; else h += k; }
        amt = Math.min(1000, Math.max(100, h * 100 + hotels * 300));
        log(st, `Wealth Tax: ${p.name} pays ${rupees(amt)} (₹100 per house, ₹300 per hotel, min ₹100, max ₹1,000).`);
      }
      charge(st, p.uid, amt, 'bank', sq.name);
      break;
    }
    case 'chance':
    case 'chest':
      drawCard(st, p, sq.kind);
      break;
    default: {
      // Ownable square
      const owner = st.owner[i];
      if (!owner) {
        if (s.lapFirst && !p.passed) {
          log(st, `${p.name} landed on ${sq.name} but has to cross Start once before buying.`);
        } else {
          st.step = 'buy';
        }
      } else if (owner === p.uid) {
        log(st, `${p.name} landed on their own ${sq.name}.`);
      } else if (st.mortgaged[i]) {
        log(st, `${sq.name} is mortgaged, so no rent.`);
      } else {
        const rent = rentFor(st, i, st.dice ? st.dice[0] + st.dice[1] : 7);
        const o = playerOf(st, owner);
        log(st, `${p.name} pays ${rupees(rent)} rent to ${o.name} for ${sq.name}.`);
        charge(st, p.uid, rent, owner, `rent on ${sq.name}`);
      }
    }
  }
}

function drawCard(st, p, deck) {
  const list = deck === 'chance' ? CHANCE : CHEST;
  const k = st.decks[deck].shift();
  const card = list[k];
  st.card = { deck, t: card.t, by: p.uid, n: (st.card ? st.card.n : 0) + 1 };
  log(st, `${p.name} drew ${deck === 'chance' ? 'Chance' : 'Community Chest'}: ${card.t}`);
  const [kind, a, b] = card.e;
  if (kind !== 'jailFree') st.decks[deck].push(k);
  switch (kind) {
    case 'get': give(st, p.uid, a); break;
    case 'pay': charge(st, p.uid, a, 'bank', 'card'); break;
    case 'jail': sendToJail(st, p); break;
    case 'jailFree': p.jailCards.push(deck); break;
    case 'goto': moveTo(st, p, a); land(st, p); break;
    case 'back': p.pos = (p.pos - a + N) % N; land(st, p); break;
    case 'payEach': for (const q of active(st)) if (q.uid !== p.uid) charge(st, p.uid, a, q.uid, 'card'); break;
    case 'getEach': for (const q of active(st)) if (q.uid !== p.uid) charge(st, q.uid, a, p.uid, 'birthday'); break;
    case 'repairs': {
      let amt = 0;
      for (const j of OWNABLE) if (st.owner[j] === p.uid) { const h = st.houses[j] || 0; amt += h === HOTEL ? b : h * a; }
      if (amt) charge(st, p.uid, amt, 'bank', 'repairs'); else log(st, `${p.name} has no buildings, so nothing to pay.`);
      break;
    }
  }
}

// ---------- a turn ----------
function roll(st, p) {
  need(st.step === 'roll', st.step === 'after' ? 'You already rolled. End your turn.' : 'Finish this first.');
  const d = [die(), die()];
  st.dice = d;
  st.moveNo++;
  const dbl = d[0] === d[1];
  const total = d[0] + d[1];
  log(st, `${p.name} rolled ${d[0]} + ${d[1]} = ${total}${dbl ? ' (double)' : ''}.`);

  if (!p.started) {
    if (total === 12) { p.started = true; log(st, `${p.name} rolled 12 and is off.`); }
    else { log(st, `${p.name} needs a 12 to leave Start.`); st.step = 'after'; st.rolledDoubles = false; return; }
  }

  if (p.jail) {
    if (dbl) {
      p.jail = 0;
      log(st, `${p.name} rolled a double and is out of Jail.`);
      st.rolledDoubles = false; // no extra roll after leaving jail on a double
    } else if (p.jail >= 3) {
      p.jail = 0;
      log(st, `Third try failed. ${p.name} pays the ${rupees(st.settings.jailFine)} fine and moves.`);
      charge(st, p.uid, st.settings.jailFine, 'bank', 'jail fine');
      st.rolledDoubles = false;
    } else {
      p.jail++;
      st.step = 'after';
      st.rolledDoubles = false;
      return;
    }
  } else if (dbl) {
    p.doubles++;
    if (p.doubles >= 3) { log(st, `Three doubles in a row.`); sendToJail(st, p); st.step = 'after'; return; }
    st.rolledDoubles = true;
  } else {
    st.rolledDoubles = false;
  }

  const dest = (p.pos + total) % N;
  moveTo(st, p, dest);
  st.step = 'after';
  land(st, p);
}

function endTurn(st) {
  need(st.step === 'after', st.step === 'roll' ? 'Roll first.' : 'Finish this first.');
  need(!st.debts.length, 'Someone still owes money.');
  const p = cur(st);
  if (st.rolledDoubles && !p.jail && !p.out) {
    st.step = 'roll';
    st.rolledDoubles = false;
    log(st, `${p.name} rolled a double and goes again.`);
    return;
  }
  advanceTurn(st);
}
function advanceTurn(st) {
  if (checkOver(st)) return;
  const n = st.players.length;
  let i = st.turn;
  for (let k = 0; k < n * 2; k++) {
    const prev = i;
    i = (i + 1) % n;
    if (i <= prev) { st.round++; if (st.settings.roundLimit && st.round > st.settings.roundLimit) { finish(st, 'rounds'); return; } }
    const q = st.players[i];
    if (q.out) continue;
    if (q.skip) { q.skip = 0; log(st, `${q.name} misses this turn (Rest House).`); continue; }
    break;
  }
  st.turn = i;
  const p = cur(st);
  p.doubles = 0;
  st.step = 'roll';
  st.dice = null;
  st.rolledDoubles = false;
  st.moveNo++;
}

// ---------- buying and auctions ----------
function buy(st, p) {
  need(st.step === 'buy', 'Nothing to buy right now.');
  const i = p.pos;
  const sq = BOARD[i];
  need(p.cash >= sq.price, `You need ${rupees(sq.price)} to buy ${sq.name}.`);
  p.cash -= sq.price;
  st.owner[i] = p.uid;
  st.step = 'after';
  st.moveNo++;
  log(st, `${p.name} bought ${sq.name} for ${rupees(sq.price)}.`);
}
const AUCTION_MS = 12000;
function pass(st, p, now) {
  need(st.step === 'buy', 'Nothing to pass on.');
  const i = p.pos;
  st.moveNo++;
  if (!st.settings.auctions) { st.step = 'after'; log(st, `${p.name} passed on ${BOARD[i].name}.`); return; }
  const bidders = active(st).filter((q) => !q.left || q.bot).map((q) => q.uid);
  st.auction = { pos: i, high: 0, by: null, in: bidders, endsAt: now + AUCTION_MS + 4000, n: 0 };
  st.step = 'auction';
  log(st, `${p.name} passed. ${BOARD[i].name} goes to auction.`);
}
function bid(st, uid, amount, now) {
  const a = st.auction;
  need(st.step === 'auction' && a, 'No auction going on.');
  need(a.in.includes(uid), 'You dropped out of this auction.');
  need(a.by !== uid, "You're already the top bid.");
  amount = Math.floor(Number(amount) || 0);
  need(amount > a.high && amount >= 100, `Bid more than ${rupees(a.high)}.`);
  need(amount % 50 === 0, 'Bid in steps of ₹50.');
  need(playerOf(st, uid).cash >= amount, "You don't have that much cash.");
  a.high = amount;
  a.by = uid;
  a.n++;
  a.endsAt = Math.max(a.endsAt, now + 8000);
  log(st, `${playerOf(st, uid).name} bids ${rupees(amount)}.`);
  maybeCloseAuction(st, now);
}
function fold(st, uid, now) {
  const a = st.auction;
  need(st.step === 'auction' && a, 'No auction going on.');
  need(a.in.includes(uid), 'You already dropped out.');
  need(a.by !== uid, "You're the top bid, you can't drop out.");
  a.in = a.in.filter((u) => u !== uid);
  maybeCloseAuction(st, now);
}
function maybeCloseAuction(st, now) {
  const a = st.auction;
  const others = a.in.filter((u) => u !== a.by);
  if (others.length && now < a.endsAt) return;
  const sq = BOARD[a.pos];
  if (a.by && playerOf(st, a.by).cash >= a.high) {
    const w = playerOf(st, a.by);
    w.cash -= a.high;
    st.owner[a.pos] = w.uid;
    log(st, `${w.name} won ${sq.name} at auction for ${rupees(a.high)}.`);
  } else {
    log(st, `Nobody bought ${sq.name}. It stays with the bank.`);
  }
  st.auction = null;
  st.step = 'after';
  st.moveNo++;
}

// ---------- buildings and mortgages ----------
function build(st, p, i) {
  const why = canBuild(st, p.uid, i);
  need(!why, why);
  p.cash -= BUILD[BOARD[i].g];
  st.houses[i] = (st.houses[i] || 0) + 1;
  log(st, `${p.name} built ${st.houses[i] === HOTEL ? 'a hotel' : 'a house'} on ${BOARD[i].name}.`);
}
function sellHouse(st, p, i) {
  const why = canSellHouse(st, p.uid, i);
  need(!why, why);
  const was = st.houses[i];
  st.houses[i] = was - 1;
  if (!st.houses[i]) delete st.houses[i];
  const back = Math.floor(BUILD[BOARD[i].g] / 2);
  p.cash += back;
  log(st, `${p.name} sold ${was === HOTEL ? 'the hotel' : 'a house'} on ${BOARD[i].name} for ${rupees(back)}.`);
}
function mortgage(st, p, i) {
  const why = canMortgage(st, p.uid, i);
  need(!why, why);
  st.mortgaged[i] = true;
  p.cash += mortgageValue(i);
  log(st, `${p.name} mortgaged ${BOARD[i].name} for ${rupees(mortgageValue(i))}.`);
}
function unmortgage(st, p, i) {
  const why = canUnmortgage(st, p.uid, i);
  need(!why, why);
  p.cash -= unmortgageCost(i);
  delete st.mortgaged[i];
  log(st, `${p.name} lifted the mortgage on ${BOARD[i].name}.`);
}

// ---------- trades ----------
function cleanList(st, uid, list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const i = Number(x);
    need(isOwnable(i) && st.owner[i] === uid, 'Can only trade property you own.');
    const sq = BOARD[i];
    need(sq.kind !== 'city' || !groupSquares(sq.g).some((j) => st.houses[j]), `Sell the buildings in the ${GROUPS[sq.g].name} colour before trading ${sq.name}.`);
    if (!out.includes(i)) out.push(i);
  }
  return out;
}
export const TRADE_MS = 60000;
function proposeTrade(st, uid, a, now) {
  need(!st.trade, 'Another trade is waiting for an answer.');
  need(st.step !== 'auction' && !st.debts.length, 'Wait until this is settled.');
  const to = playerOf(st, a.to);
  need(to && !to.out && to.uid !== uid, 'Pick who to trade with.');
  const give = cleanList(st, uid, a.give);
  const get = cleanList(st, to.uid, a.get);
  const giveCash = Math.max(0, Math.floor(Number(a.giveCash) || 0));
  const getCash = Math.max(0, Math.floor(Number(a.getCash) || 0));
  need(give.length || get.length || giveCash || getCash, 'Put something in the deal.');
  need(!(giveCash && getCash), 'Only one side pays cash.');
  need(playerOf(st, uid).cash >= giveCash, "You don't have that much cash.");
  st.trade = { from: uid, to: to.uid, give, get, giveCash, getCash, at: now || Date.now() };
  log(st, `${playerOf(st, uid).name} offered ${to.name} a deal.`);
}
function answerTrade(st, uid, yes) {
  const t = st.trade;
  need(t, 'No deal on the table.');
  need(t.to === uid || (t.from === uid && !yes), 'This deal is not yours to answer.');
  st.trade = null;
  const A = playerOf(st, t.from), B = playerOf(st, t.to);
  if (!yes) { log(st, t.from === uid ? `${A.name} pulled the deal.` : `${B.name} said no to the deal.`); return; }
  // Re-check everything; things may have changed since the offer.
  const still = (list, owner) => list.every((i) => st.owner[i] === owner && !(BOARD[i].kind === 'city' && groupSquares(BOARD[i].g).some((j) => st.houses[j])));
  need(still(t.give, A.uid) && still(t.get, B.uid), 'The deal is out of date. Make a new one.');
  need(A.cash >= t.giveCash && B.cash >= t.getCash, 'Not enough cash for that deal any more.');
  for (const i of t.give) st.owner[i] = B.uid;
  for (const i of t.get) st.owner[i] = A.uid;
  A.cash += t.getCash - t.giveCash;
  B.cash += t.giveCash - t.getCash;
  st.moveNo++;
  log(st, `Deal done between ${A.name} and ${B.name}.`);
}

// ---------- jail ----------
function payJail(st, p) {
  need(p.jail && st.step === 'roll' && cur(st) === p, 'Not in Jail.');
  need(p.cash >= st.settings.jailFine, `The fine is ${rupees(st.settings.jailFine)}.`);
  p.cash -= st.settings.jailFine;
  p.jail = 0;
  log(st, `${p.name} paid ${rupees(st.settings.jailFine)} and is out of Jail.`);
}
function useJailCard(st, p) {
  need(p.jail && st.step === 'roll' && cur(st) === p, 'Not in Jail.');
  need(p.jailCards.length, 'No Get out of Jail free card.');
  const deck = p.jailCards.shift();
  const list = deck === 'chance' ? CHANCE : CHEST;
  st.decks[deck].push(list.findIndex((c) => c.e[0] === 'jailFree'));
  p.jail = 0;
  log(st, `${p.name} used a Get out of Jail free card.`);
}

// ---------- bankruptcy and the end ----------
function bankrupt(st, uid) {
  const p = playerOf(st, uid);
  const d = st.debts.find((x) => x.uid === uid);
  const to = d ? d.to : 'bank';
  // Buildings go back to the bank at half price; that money joins their cash.
  for (const i of OWNABLE) {
    if (st.owner[i] !== uid) continue;
    const h = st.houses[i] || 0;
    if (h) { p.cash += Math.floor((h * BUILD[BOARD[i].g]) / 2); delete st.houses[i]; }
  }
  const creditor = to !== 'bank' && to !== 'each' ? playerOf(st, to) : null;
  if (creditor && !creditor.out) {
    creditor.cash += Math.max(0, p.cash);
    for (const i of OWNABLE) if (st.owner[i] === uid) st.owner[i] = creditor.uid;
    creditor.jailCards.push(...p.jailCards);
    log(st, `${p.name} is bankrupt. Everything goes to ${creditor.name}.`);
  } else {
    if (to === 'each') payOut(st, uid, 'each', Math.max(0, p.cash));
    for (const i of OWNABLE) if (st.owner[i] === uid) { delete st.owner[i]; delete st.mortgaged[i]; }
    for (const deck of p.jailCards) st.decks[deck].push((deck === 'chance' ? CHANCE : CHEST).findIndex((c) => c.e[0] === 'jailFree'));
    log(st, `${p.name} is bankrupt. Their property goes back to the bank.`);
  }
  p.cash = 0;
  p.jailCards = [];
  p.out = true;
  st.debts = st.debts.filter((x) => x.uid !== uid && x.to !== uid);
  if (st.trade && (st.trade.from === uid || st.trade.to === uid)) st.trade = null;
  if (st.auction) { st.auction.in = st.auction.in.filter((u) => u !== uid); if (st.auction.by === uid) { st.auction.by = null; st.auction.high = 0; } }
  st.moveNo++;
  if (checkOver(st)) return;
  // If it was their turn, move on.
  if (cur(st).uid === uid && !st.debts.length) {
    if (st.auction) return;
    advanceTurn(st);
  }
}
function checkOver(st) {
  if (active(st).length <= 1) { finish(st, 'last'); return true; }
  return false;
}
function finish(st, why) {
  st.phase = 'over';
  st.trade = null;
  st.auction = null;
  st.debts = [];
  const ranked = st.players.map((p) => ({ uid: p.uid, worth: p.out ? -1 : netWorth(st, p.uid) })).sort((a, b) => b.worth - a.worth);
  st.ranking = ranked;
  st.winner = ranked[0].uid;
  st.moveNo++;
  log(st, why === 'rounds' ? `Round limit reached. ${playerOf(st, st.winner).name} is the richest and wins.` : `${playerOf(st, st.winner).name} wins the game.`);
}

// ---------- the one entry point for every player action ----------
export const AWAY_MS = 70000;
const TURN_MOVES = ['roll', 'buy', 'pass', 'end', 'payJail', 'jailCard'];
export function dispatch(st, uid, a, now, presence = {}) {
  const me = playerOf(st, uid);
  need(me, 'You are not at this table.');
  const type = a && a.type;
  if (!['autopilot', 'claimHost', 'leave', 'settings', 'addBot', 'remove', 'start', 'rematch'].includes(type) && me.auto && !me.bot) me.auto = false;

  if (TURN_MOVES.includes(type)) {
    need(st.phase === 'play', 'The game is not running.');
    need(cur(st).uid === uid, "It's not your turn.");
    need(!st.debts.length, 'Someone still owes money. That gets sorted first.');
  }
  const i = Number(a && a.sq);

  switch (type) {
    case 'addBot':
      need(isHost(st, uid), 'Only the host can add computer players.');
      need(st.phase === 'lobby', 'Add computer players before the game starts.');
      addBot(st);
      break;
    case 'remove': {
      need(isHost(st, uid), 'Only the host can remove players.');
      need(st.phase === 'lobby', 'Players can only be removed in the lobby.');
      need(a.uid !== uid, 'Use Leave to leave the table yourself.');
      const k = idxOf(st, a.uid);
      need(k >= 0, 'That player already left.');
      st.players.splice(k, 1);
      break;
    }
    case 'settings':
      need(isHost(st, uid), 'Only the host can change the rules.');
      need(st.phase === 'lobby', 'Rules are locked once the game starts.');
      applySettings(st, a.settings || {});
      break;
    case 'start':
      need(isHost(st, uid), 'Only the host can start.');
      need(st.phase === 'lobby', 'The game already started.');
      startGame(st);
      break;
    case 'roll': roll(st, me); break;
    case 'buy': buy(st, me); break;
    case 'pass': pass(st, me, now); break;
    case 'end': endTurn(st); break;
    case 'payJail': payJail(st, me); break;
    case 'jailCard': useJailCard(st, me); break;
    case 'bid': need(st.phase === 'play', 'The game is not running.'); bid(st, uid, a.amount, now); break;
    case 'fold': need(st.phase === 'play', 'The game is not running.'); fold(st, uid, now); break;
    case 'build':
    case 'unmortgage':
      need(st.phase === 'play', 'The game is not running.');
      need(cur(st).uid === uid, 'You can build or lift mortgages on your own turn.');
      need(st.step !== 'auction' && st.step !== 'buy', 'Finish this first.');
      need(!st.debts.length, 'Someone still owes money. That gets sorted first.');
      if (type === 'build') build(st, me, i); else unmortgage(st, me, i);
      break;
    case 'sell':
    case 'mortgage': {
      need(st.phase === 'play', 'The game is not running.');
      const inDebt = st.debts.length && st.debts[0].uid === uid;
      need(cur(st).uid === uid || inDebt, 'You can sell or mortgage on your own turn, or when you owe money.');
      need(st.step !== 'auction', 'Wait for the auction to finish.');
      if (type === 'sell') sellHouse(st, me, i); else mortgage(st, me, i);
      settleDebts(st);
      break;
    }
    case 'bankrupt': {
      need(st.phase === 'play', 'The game is not running.');
      need(st.debts.length && st.debts[0].uid === uid, "You don't owe anything right now.");
      bankrupt(st, uid);
      break;
    }
    case 'trade':
      need(st.phase === 'play' && !me.out, 'The game is not running.');
      proposeTrade(st, uid, a, now);
      break;
    case 'tradeAnswer':
      need(st.phase === 'play', 'The game is not running.');
      answerTrade(st, uid, !!a.yes);
      break;
    case 'autopilot': {
      const target = playerOf(st, a.uid || uid);
      need(target && !target.bot, 'No such player.');
      need(st.phase !== 'lobby', 'Autopilot is only for during a game.');
      if (target.uid !== uid) {
        need(isHost(st, uid), 'Only the host can do that for someone else.');
        const seen = presence[target.uid] || 0;
        need(!a.on || now - seen > AWAY_MS, `${target.name} is still connected. Give them a minute.`);
      }
      target.auto = !!a.on;
      if (!a.on) target.left = false;
      break;
    }
    case 'claimHost': {
      need(!isHost(st, uid), "You're already the host.");
      const host = playerOf(st, st.hostUid);
      const seen = presence[st.hostUid] || 0;
      need(!host || host.left || now - seen > AWAY_MS, 'The host is still connected.');
      st.hostUid = uid;
      break;
    }
    case 'leave':
      if (st.phase === 'lobby') {
        st.players.splice(idxOf(st, uid), 1);
      } else {
        me.left = true;
        me.auto = true;
      }
      if (isHost(st, uid)) {
        const next = st.players.find((p) => !p.bot && !p.left && p.uid !== uid);
        if (next) st.hostUid = next.uid;
      }
      break;
    case 'rematch':
      need(isHost(st, uid), 'Only the host can start a rematch.');
      need(st.phase === 'over', 'Finish this game first.');
      st.players = st.players.filter((p) => !p.left);
      for (const p of st.players) Object.assign(p, newPlayer(p.uid, p.name, p.bot));
      Object.assign(st, { phase: 'lobby', owner: {}, houses: {}, mortgaged: {}, step: 'roll', dice: null, auction: null, debts: [], trade: null, card: null, log: [], winner: null, ranking: null, round: 1 });
      break;
    default:
      throw new Error('Unknown move.');
  }
  st.botAt = Math.max(st.botAt, now + 600);
  st.seq++;
  st.lastActive = now;
}

// ---------- computer players ----------
const RESERVE = 1500;
function botValue(st, uid, i) {
  // How much a property is worth to this bot. More if it finishes or blocks a colour.
  const sq = BOARD[i];
  let v = sq.price;
  if (sq.kind === 'city') {
    const g = groupSquares(sq.g).filter((j) => j !== i);
    const mine = g.filter((j) => st.owner[j] === uid).length;
    const theirs = new Set(g.map((j) => st.owner[j]).filter((o) => o && o !== uid));
    if (mine === 2) v *= 1.8;
    else if (mine === 1) v *= 1.25;
    if (theirs.size === 1 && g.every((j) => st.owner[j] && st.owner[j] !== uid)) v *= 1.4; // blocks someone's set
  } else if (sq.kind === 'transport') {
    const mine = OWNABLE.filter((j) => BOARD[j].kind === 'transport' && st.owner[j] === uid).length;
    v *= 1 + mine * 0.2;
  }
  return v;
}
function botManage(st, p) {
  // Lift mortgages and build when there's spare cash. One action per call.
  for (const i of OWNABLE) {
    if (st.owner[i] === p.uid && st.mortgaged[i] && p.cash - unmortgageCost(i) > RESERVE * 2) { unmortgage(st, p, i); return true; }
  }
  const options = OWNABLE.filter((i) => !canBuild(st, p.uid, i) && p.cash - BUILD[BOARD[i].g] > RESERVE + 500)
    .sort((x, y) => (st.houses[x] || 0) - (st.houses[y] || 0) || BOARD[y].price - BOARD[x].price);
  if (options.length) { build(st, p, options[0]); return true; }
  return false;
}
function botRaise(st, p) {
  // Sell buildings first (cheapest groups first), then mortgage the least useful property.
  const sells = OWNABLE.filter((i) => !canSellHouse(st, p.uid, i)).sort((x, y) => BUILD[BOARD[x].g] - BUILD[BOARD[y].g]);
  if (sells.length) { sellHouse(st, p, sells[0]); return true; }
  const morts = OWNABLE.filter((i) => !canMortgage(st, p.uid, i)).sort((x, y) => {
    const sx = BOARD[x].kind === 'city' && ownsGroup(st, p.uid, BOARD[x].g) ? 1 : 0;
    const sy = BOARD[y].kind === 'city' && ownsGroup(st, p.uid, BOARD[y].g) ? 1 : 0;
    return sx - sy || BOARD[x].price - BOARD[y].price;
  });
  if (morts.length) { mortgage(st, p, morts[0]); return true; }
  return false;
}
// A computer player with two of a colour tries to buy or swap for the third. At most once every 3 rounds.
function botOffer(st, p) {
  st.offers = st.offers || {};
  const last = st.offers[p.uid];
  if (last && st.round - last.round < 3) return false;
  for (let g = 6; g >= 1; g--) {
    const sqs = groupSquares(g);
    if (sqs.filter((j) => st.owner[j] === p.uid).length !== 2) continue;
    const want = sqs.find((j) => st.owner[j] !== p.uid);
    const holder = st.owner[want] && playerOf(st, st.owner[want]);
    if (!holder || holder.out || st.mortgaged[want]) continue;
    if (last && last.want === want && st.round - last.round < 8) continue;
    if (sqs.some((j) => st.houses[j])) continue;
    // Swap: something of mine that finishes a colour for them.
    const swap = OWNABLE.find((k) => st.owner[k] === p.uid && BOARD[k].kind === 'city' && BOARD[k].g !== g
      && !groupSquares(BOARD[k].g).some((j) => st.houses[j])
      && groupSquares(BOARD[k].g).filter((j) => j !== k).every((j) => st.owner[j] === holder.uid));
    st.offers[p.uid] = { round: st.round, want };
    if (swap != null) {
      const diff = Math.max(0, BOARD[want].price - BOARD[swap].price);
      const cash = Math.min(Math.round(diff / 50) * 50, Math.max(0, p.cash - RESERVE));
      proposeTrade(st, p.uid, { to: holder.uid, give: [swap], get: [want], giveCash: cash }, st.now);
      return true;
    }
    const cash = Math.round((BOARD[want].price * 2.6) / 50) * 50;
    if (p.cash - cash < RESERVE) continue;
    proposeTrade(st, p.uid, { to: holder.uid, give: [], get: [want], giveCash: cash }, st.now);
    return true;
  }
  return false;
}
function botLikesTrade(st, t) {
  const me = t.to;
  let gain = t.giveCash - t.getCash;
  for (const i of t.give) gain += botValue(st, me, i);
  for (const i of t.get) {
    let v = botValue(st, me, i);
    if (BOARD[i].kind === 'city' && ownsGroup(st, me, BOARD[i].g)) v *= 2;
    // Giving away the last piece of someone else's set costs extra.
    if (BOARD[i].kind === 'city') {
      const rest = groupSquares(BOARD[i].g).filter((j) => j !== i);
      if (rest.every((j) => st.owner[j] === t.from)) v *= 1.5;
    }
    gain -= v;
  }
  const cashAfter = playerOf(st, me).cash + t.giveCash - t.getCash;
  return gain > 0 && cashAfter >= 0;
}

// Makes at most one computer move if one is due. Returns true if something changed.
export function runBots(st, now) {
  if (st.phase !== 'play') return false;
  st.now = now;
  let acted = false;
  // Auctions close on a timer even with no computer players.
  if (st.step === 'auction' && st.auction && now >= st.auction.endsAt) {
    maybeCloseAuction(st, now);
    acted = true;
  } else if (st.trade && st.trade.at && now - st.trade.at > TRADE_MS) {
    log(st, `The deal to ${playerOf(st, st.trade.to).name} expired.`);
    st.trade = null;
    acted = true;
  } else if (now < st.botAt) {
    return false;
  } else if (st.trade && computerRuns(playerOf(st, st.trade.to))) {
    answerTrade(st, st.trade.to, botLikesTrade(st, st.trade));
    acted = true;
  } else if (st.debts.length) {
    const d = st.debts[0];
    const p = playerOf(st, d.uid);
    if (computerRuns(p)) {
      if (!botRaise(st, p)) bankrupt(st, p.uid);
      else settleDebts(st);
      acted = true;
    }
  } else if (st.step === 'auction' && st.auction) {
    const a = st.auction;
    for (const u of a.in) {
      const p = playerOf(st, u);
      if (!computerRuns(p) || a.by === u) continue;
      const max = Math.min(botValue(st, u, a.pos) * (p.auto && !p.bot ? 0.6 : 0.95), p.cash - RESERVE);
      const next = a.high + (a.high < 2000 ? 100 : 250);
      if (next <= max) bid(st, u, next, now); else fold(st, u, now);
      acted = true;
      break;
    }
  } else {
    const p = cur(st);
    if (computerRuns(p) && !p.out) {
      if (st.step === 'roll') {
        if (p.jail) {
          const unowned = OWNABLE.filter((i) => !st.owner[i]).length;
          if (p.jailCards.length) useJailCard(st, p);
          else if (unowned > 8 && p.cash > st.settings.jailFine + RESERVE) payJail(st, p);
          else roll(st, p);
        } else if (!botManage(st, p) && !(p.bot && !st.trade && botOffer(st, p))) roll(st, p);
      } else if (st.step === 'buy') {
        const sq = BOARD[p.pos];
        const keep = p.auto && !p.bot ? RESERVE * 2 : RESERVE;
        if (p.cash - sq.price >= keep || (botValue(st, p.uid, p.pos) > sq.price * 1.5 && p.cash >= sq.price)) buy(st, p);
        else pass(st, p, now);
      } else if (st.step === 'after') {
        if (!botManage(st, p)) endTurn(st);
      }
      acted = true;
    }
  }
  if (acted) {
    st.seq++;
    st.lastActive = now;
    st.botAt = Math.max(st.botAt, now + 750);
  }
  return acted;
}

// ---------- what a player sees ----------
// Nothing in this game is secret except the order of the card decks, so every player gets the same picture.
export function viewFor(st, uid) {
  return {
    id: st.id,
    me: uid,
    seq: st.seq,
    moveNo: st.moveNo,
    phase: st.phase,
    hostUid: st.hostUid,
    settings: st.settings,
    serverNow: st.now || Date.now(),
    botAt: st.botAt,
    players: st.players.map((p) => ({
      uid: p.uid, name: p.name, bot: p.bot, auto: p.auto, left: p.left, out: p.out,
      cash: p.cash, pos: p.pos, jail: p.jail, jailCards: p.jailCards.length, passed: p.passed, started: p.started, skip: p.skip,
      worth: st.phase === 'lobby' ? 0 : netWorth(st, p.uid),
    })),
    owner: st.owner,
    houses: st.houses,
    mortgaged: st.mortgaged,
    turn: st.phase === 'play' ? cur(st).uid : null,
    step: st.step,
    dice: st.dice,
    rolledDoubles: st.rolledDoubles,
    auction: st.auction,
    debts: st.debts,
    trade: st.trade,
    card: st.card,
    round: st.round,
    log: st.log.slice(-40),
    winner: st.winner,
    ranking: st.ranking,
  };
}

// For tests: run the landing rules for a player on their current square.
export const _land = (st, uid) => land(st, playerOf(st, uid));
