// Online server tests against an in-memory stand-in for Firestore. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer, COL } from '../functions/server.js';

// Tiny fake of the Firestore calls the server uses. Transactions run one at a time, like Firestore retries make them behave.
function fakeDb() {
  const data = new Map();
  let queue = Promise.resolve();
  const ref = (path) => ({
    path,
    collection: (c) => col(path + '/' + c),
  });
  const col = (path) => ({
    path, isCol: true,
    doc: (id) => ({ ...ref(path + '/' + id), id }),
  });
  const tx = {
    async get(r) {
      if (r.isCol) {
        const docs = [...data.entries()].filter(([k]) => k.startsWith(r.path + '/') && !k.slice(r.path.length + 1).includes('/'))
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
        return { docs };
      }
      const v = data.get(r.path);
      return { exists: v !== undefined, data: () => v };
    },
    set(r, v) { data.set(r.path, structuredClone(v)); },
  };
  return {
    data,
    collection: (c) => col(c),
    runTransaction(fn) {
      const run = queue.then(() => {
        const snapshot = new Map(data);
        return fn(tx).catch((e) => { data.clear(); for (const [k, v] of snapshot) data.set(k, v); throw e; });
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

async function setup(n = 3) {
  const db = fakeDb();
  const s = makeServer(db);
  const r = await s.handle('u0', { op: 'create', name: 'Host' });
  const id = r.tableId;
  for (let i = 1; i < n; i++) await s.handle('u' + i, { op: 'join', tableId: id, name: 'P' + i });
  return { db, s, id };
}
const views = (db, id) => [...db.data.entries()].filter(([k]) => k.startsWith(`${COL}/${id}/views/`));

test('create and join over the server, lowercase code works', async () => {
  const { s, id } = await setup(2);
  const r = await s.handle('u2', { op: 'join', tableId: id.toLowerCase(), name: 'Third' });
  assert.equal(r.view.players.length, 3);
  await assert.rejects(s.handle('u9', { op: 'join', tableId: 'NOPE1', name: 'X' }), /No table/);
  await assert.rejects(s.handle(null, { op: 'join', tableId: id, name: 'X' }), /Sign in/);
});

test('the card deck order stays in secret; views and the public doc never carry it', async () => {
  const { db, s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  const st = JSON.parse(db.data.get(`${COL}/${id}/secret/state`).json);
  assert.equal(st.decks.chance.length, 14);
  for (const [path, doc] of views(db, id)) {
    const v = JSON.parse(doc.json);
    assert.equal(v.me, path.split('/').pop());
    assert.ok(!('decks' in v));
  }
  assert.ok(!JSON.stringify(db.data.get(`${COL}/${id}`)).includes('decks'));
});

test('outsiders cannot read or act at a table, even knowing the code', async () => {
  const { s, id } = await setup(3);
  await assert.rejects(s.handle('stranger', { op: 'view', tableId: id }), /not at this table/);
  await assert.rejects(s.handle('stranger', { op: 'act', tableId: id, action: { type: 'start' } }), /not at this table/);
});

test('you cannot act for someone else: the server uses your sign-in, not what you send', async () => {
  const { db, s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  const st = JSON.parse(db.data.get(`${COL}/${id}/secret/state`).json);
  const other = st.players.find((p, i) => i !== st.turn).uid;
  await assert.rejects(s.handle(other, { op: 'act', tableId: id, action: { type: 'roll', uid: st.players[st.turn].uid } }), /not your turn/);
});

test('duplicate taps count once; a roll from an old screen is refused', async () => {
  const { db, s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  let st = JSON.parse(db.data.get(`${COL}/${id}/secret/state`).json);
  const who = st.players[st.turn].uid;
  const a = { type: 'roll', rid: 'r1', move: st.moveNo };
  const [r1, r2] = await Promise.all([
    s.handle(who, { op: 'act', tableId: id, action: a }),
    s.handle(who, { op: 'act', tableId: id, action: a }),
  ]);
  assert.ok(r1.ok && r2.ok && r2.dup);
  st = JSON.parse(db.data.get(`${COL}/${id}/secret/state`).json);
  assert.equal(st.log.filter((l) => l.includes(' rolled ')).length, 1);
  const r3 = await s.handle(who, { op: 'act', tableId: id, action: { type: 'roll', rid: 'r2', move: st.moveNo - 1 } });
  assert.equal(r3.ok, false);
  assert.ok(r3.stale);
});

test('reconnect: a seated player rejoining gets their seat back; latecomers cannot join a running game', async () => {
  const { s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  const again = await s.handle('u1', { op: 'join', tableId: id, name: 'P1' });
  assert.equal(again.view.me, 'u1');
  assert.equal(again.view.players.length, 3);
  await assert.rejects(s.handle('late', { op: 'join', tableId: id, name: 'Late' }), /already started/);
});

test('a whole online game finishes when everyone is on autopilot', async () => {
  const { db, s, id } = await setup(3);
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'settings', settings: { roundLimit: 15 } } });
  await s.handle('u0', { op: 'act', tableId: id, action: { type: 'start' } });
  for (const u of ['u0', 'u1', 'u2']) await s.handle(u, { op: 'act', tableId: id, action: { type: 'autopilot', on: true } });
  let t = Date.now(), v;
  for (let i = 0; i < 20000; i++) {
    t += 2000;
    v = (await s.handle('u0', { op: 'tick', tableId: id }, t)).view;
    if (v.phase === 'over') break;
  }
  assert.equal(v.phase, 'over');
  assert.ok(v.winner);
  assert.ok(db.data.get(`${COL}/${id}`).phase === 'over');
});

test('old tables expire', async () => {
  const { s, id } = await setup(3);
  await assert.rejects(s.handle('u0', { op: 'view', tableId: id }, Date.now() + 25 * 3600 * 1000), /expired/);
});
