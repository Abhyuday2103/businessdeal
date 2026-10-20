import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../docs/engine.js';

function table(n = 3) {
  const st = E.createTable('T', 'a', 'Asha');
  E.joinTable(st, 'b', 'Bunty');
  if (n > 2) E.joinTable(st, 'c', 'Chintu');
  E.dispatch(st, 'a', { type: 'start' }, 0);
  st.players.sort((x, y) => x.uid.localeCompare(y.uid)); // a, b, c in order for predictable tests
  st.turn = 0;
  for (const p of st.players) p.passed = true;
  return st;
}
const P = (st, uid) => st.players.find((p) => p.uid === uid);

test('board has 36 squares with 18 cities in 6 groups of 3', () => {
  assert.equal(E.BOARD.length, 36);
  for (let g = 1; g <= 6; g++) assert.equal(E.groupSquares(g).length, 3);
  assert.equal(E.BOARD[0].kind, 'start');
  assert.equal(E.BOARD[9].kind, 'jail');
  assert.equal(E.BOARD[18].kind, 'club');
  assert.equal(E.BOARD[27].kind, 'rest');
});

test('everyone starts with the start cash', () => {
  const st = table();
  for (const p of st.players) assert.equal(p.cash, 15000);
});

test('rent doubles with the full colour, then houses and hotel', () => {
  const st = table();
  const [s1, s2, s3] = E.groupSquares(1);
  st.owner[s1] = 'a';
  assert.equal(E.rentFor(st, s1, 7), E.BOARD[s1].rent[0]);
  st.owner[s2] = 'a'; st.owner[s3] = 'a';
  assert.equal(E.rentFor(st, s1, 7), E.BOARD[s1].rent[0] * 2);
  st.houses[s1] = 2;
  assert.equal(E.rentFor(st, s1, 7), E.BOARD[s1].rent[2]);
  st.houses[s1] = E.HOTEL;
  assert.equal(E.rentFor(st, s1, 7), E.BOARD[s1].rent[4]);
  st.mortgaged[s2] = true;
  assert.equal(E.rentFor(st, s2, 7), 0);
});

test('must build evenly and need the whole colour', () => {
  const st = table();
  const [s1, s2, s3] = E.groupSquares(2);
  st.owner[s1] = 'a'; st.owner[s2] = 'a';
  assert.match(E.canBuild(st, 'a', s1), /need all three/);
  st.owner[s3] = 'a';
  st.step = 'after';
  E.dispatch(st, 'a', { type: 'build', sq: s1 }, 0);
  assert.equal(st.houses[s1], 1);
  assert.throws(() => E.dispatch(st, 'a', { type: 'build', sq: s1 }, 0), /evenly/);
  E.dispatch(st, 'a', { type: 'build', sq: s2 }, 0);
  E.dispatch(st, 'a', { type: 'build', sq: s3 }, 0);
  E.dispatch(st, 'a', { type: 'build', sq: s1 }, 0);
  assert.equal(st.houses[s1], 2);
  assert.equal(P(st, 'a').cash, 15000 - 4 * E.BUILD[2]);
});

test('transport rent scales with how many you own', () => {
  const st = table();
  const tr = E.OWNABLE.filter((i) => E.BOARD[i].kind === 'transport');
  st.owner[tr[0]] = 'a';
  assert.equal(E.rentFor(st, tr[0]), E.BOARD[tr[0]].base);
  st.owner[tr[1]] = 'a';
  assert.equal(E.rentFor(st, tr[0]), E.BOARD[tr[0]].base * 2);
});

test('cannot buy before crossing Start when that rule is on', () => {
  const st = table();
  const p = P(st, 'a');
  p.passed = false;
  p.pos = 1;
  st.step = 'after';
  E._land(st, 'a');
  assert.equal(st.step, 'after');
  p.passed = true;
  E._land(st, 'a');
  assert.equal(st.step, 'buy');
});

test('auction sells to the top bidder when everyone else drops', () => {
  const st = table();
  const p = P(st, 'a');
  p.pos = 1;
  st.step = 'buy';
  E.dispatch(st, 'a', { type: 'pass' }, 1000);
  assert.equal(st.step, 'auction');
  E.dispatch(st, 'b', { type: 'bid', amount: 500 }, 1100);
  E.dispatch(st, 'c', { type: 'bid', amount: 800 }, 1200);
  E.dispatch(st, 'a', { type: 'fold' }, 1300);
  E.dispatch(st, 'b', { type: 'fold' }, 1400);
  assert.equal(st.owner[1], 'c');
  assert.equal(P(st, 'c').cash, 15000 - 800);
  assert.equal(st.step, 'after');
});

test('auction closes on the timer', () => {
  const st = table();
  P(st, 'a').pos = 1;
  st.step = 'buy';
  E.dispatch(st, 'a', { type: 'pass' }, 0);
  E.dispatch(st, 'b', { type: 'bid', amount: 300 }, 100);
  E.runBots(st, 60000);
  assert.equal(st.owner[1], 'b');
});

test('debt blocks the game until paid or bankrupt, and bankruptcy hands assets to the creditor', () => {
  const st = table();
  const a = P(st, 'a');
  const mumbai = 35;
  st.owner[mumbai] = 'b';
  st.owner[1] = 'a';
  a.cash = 100;
  a.pos = 34;
  st.dice = [1, 0];
  // simulate landing via a card move: put them there and run the landing through a 'goto' card path
  st.step = 'after';
  st.debts.push({ uid: 'a', to: 'b', amount: 5000, why: 'test' });
  assert.throws(() => E.dispatch(st, 'a', { type: 'end' }, 0), /owes/);
  E.dispatch(st, 'a', { type: 'mortgage', sq: 1 }, 0);
  assert.equal(st.debts.length, 1);
  E.dispatch(st, 'a', { type: 'bankrupt' }, 0);
  assert.equal(a.out, true);
  assert.equal(st.owner[1], 'b');
  assert.equal(st.debts.length, 0);
  assert.notEqual(st.turn, 0);
});

test('raising enough cash pays the debt automatically', () => {
  const st = table();
  const a = P(st, 'a');
  st.owner[35] = 'a';
  a.cash = 100;
  st.step = 'after';
  st.debts.push({ uid: 'a', to: 'b', amount: 2000, why: 'test' });
  E.dispatch(st, 'a', { type: 'mortgage', sq: 35 }, 0);
  assert.equal(st.debts.length, 0);
  assert.equal(a.cash, 100 + E.mortgageValue(35) - 2000);
  assert.equal(P(st, 'b').cash, 17000);
});

test('trade swaps property and cash when accepted', () => {
  const st = table();
  st.owner[1] = 'a'; st.owner[3] = 'b';
  E.dispatch(st, 'a', { type: 'trade', to: 'b', give: [1], get: [3], giveCash: 500 }, 0);
  assert.throws(() => E.dispatch(st, 'c', { type: 'tradeAnswer', yes: true }, 0), /not yours/);
  E.dispatch(st, 'b', { type: 'tradeAnswer', yes: true }, 0);
  assert.equal(st.owner[1], 'b');
  assert.equal(st.owner[3], 'a');
  assert.equal(P(st, 'a').cash, 14500);
  assert.equal(P(st, 'b').cash, 15500);
});

test('three doubles sends you to jail', () => {
  const st = table();
  const a = P(st, 'a');
  a.doubles = 2;
  // keep rolling until we get a double on the third
  let tries = 0;
  while (tries++ < 500) {
    const snap = structuredClone(st);
    E.dispatch(snap, 'a', { type: 'roll' }, 0);
    if (snap.dice[0] === snap.dice[1]) { assert.equal(P(snap, 'a').pos, E.JAIL); assert.equal(P(snap, 'a').jail, 1); return; }
  }
  assert.fail('never rolled a double');
});

test('paying the jail fine frees you', () => {
  const st = table();
  const a = P(st, 'a');
  a.pos = E.JAIL; a.jail = 1;
  E.dispatch(st, 'a', { type: 'payJail' }, 0);
  assert.equal(a.jail, 0);
  assert.equal(a.cash, 15000 - 500);
});

test('rest house collects 100 from each player, club house pays 100 to each', () => {
  const st = table();
  P(st, 'a').pos = 27;
  E._land(st, 'a');
  assert.deepEqual(st.players.map((p) => p.cash), [15200, 14900, 14900]);
  P(st, 'a').pos = 18;
  E._land(st, 'a');
  assert.deepEqual(st.players.map((p) => p.cash), [15000, 15000, 15000]);
});

test('old rule: rest house makes you miss a turn', () => {
  const st = table();
  st.settings.clubRest = 'old';
  P(st, 'a').pos = 27;
  E._land(st, 'a');
  assert.equal(P(st, 'a').skip, 1);
});

test('landing on rent you cannot afford makes a debt', () => {
  const st = table();
  st.owner[35] = 'b';
  P(st, 'a').cash = 100;
  P(st, 'a').pos = 35;
  E._land(st, 'a');
  assert.equal(st.debts.length, 1);
  assert.equal(st.debts[0].to, 'b');
});

test('full computer games always finish without errors or negative cash', () => {
  for (let g = 0; g < 60; g++) {
    const st = E.createTable('T', 'h', 'Host');
    st.players[0].bot = true;
    for (let k = 0; k < 1 + (g % 5); k++) E.dispatch(st, 'h', { type: 'addBot' }, 0);
    E.dispatch(st, 'h', { type: 'settings', settings: { roundLimit: 40, clubRest: g % 2 ? 'old' : 'money' } }, 0);
    E.dispatch(st, 'h', { type: 'start' }, 0);
    let t = 0;
    while (st.phase === 'play' && t < 4e7) {
      t += 1000;
      E.runBots(st, t);
      for (const p of st.players) assert.ok(p.out || p.cash >= 0, `${p.name} has ${p.cash}`);
    }
    assert.equal(st.phase, 'over');
    assert.ok(st.winner);
  }
});
