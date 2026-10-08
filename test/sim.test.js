const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/sim.js');

test('same seed produces the same world', () => {
  assert.deepStrictEqual(R.createWorld(4242), R.createWorld(4242));
  assert.notDeepStrictEqual(R.createWorld(4242).turns, R.createWorld(4243).turns);
});

test('every run includes a downturn and an inflation shock', () => {
  for (let s = 1; s <= 300; s++) {
    const ids = R.createWorld(s).turns.flatMap((t) => t.events.map((e) => R.BY_ID[e.id]));
    assert.ok(ids.some((e) => (e.tags || []).includes('downturn')), 'downturn in seed ' + s);
    assert.ok(ids.some((e) => (e.tags || []).includes('inflation')), 'inflation in seed ' + s);
  }
});

test('events never repeat in back-to-back turns', () => {
  for (let s = 1; s <= 300; s++) {
    const turns = R.createWorld(s).turns;
    for (let t = 1; t < turns.length; t++) {
      const prev = turns[t - 1].events.map((e) => e.id);
      for (const e of turns[t].events) assert.ok(!prev.includes(e.id), 'seed ' + s + ' turn ' + t);
    }
  }
});

test('debt is conserved: bills plus bonds equal total debt', () => {
  for (const share of [0, 0.35, 0.8]) {
    const world = R.createWorld(99);
    const st = R.newGame(world);
    while (!st.over) {
      R.beginTurn(st, world);
      R.resolveTurn(st, share);
      const bonds = st.vintages.reduce((a, v) => a + v.amount, 0);
      assert.ok(Math.abs(st.shortStock + bonds - st.debt) < 1e-6);
    }
  }
});

test('games end within ten turns with a reason', () => {
  for (let s = 1; s <= 100; s++) {
    for (const g of R.STRATEGIES) {
      const st = R.simulate(R.createWorld(s), () => g.share);
      assert.ok(st.over && st.history.length <= R.TURNS);
      assert.ok(st.won || ['interest', 'auctions'].includes(st.lossReason));
    }
  }
});

test('selling far more bonds than buyers want fails the auction and raises yields', () => {
  const world = R.createWorld(7);
  const a = R.newGame(world); R.beginTurn(a, world);
  const b = R.newGame(world); R.beginTurn(b, world);
  const ra = R.resolveTurn(a, 0.35);
  const rb = R.resolveTurn(b, 1);
  assert.ok(rb.auction.failed);
  assert.strictEqual(b.strikes, 1);
  assert.ok(rb.y10 > ra.y10 + 0.5);
});

test('balanced borrowing survives more often than all bills or all bonds', () => {
  const wins = (share) => {
    let n = 0;
    for (let s = 1; s <= 200; s++) if (R.simulate(R.createWorld(s * 31), () => share).won) n++;
    return n;
  };
  const balanced = wins(0.35);
  assert.ok(balanced > wins(0));
  assert.ok(balanced > wins(1));
});
