// Rollover simulation engine. Pure functions, no DOM. Runs in the browser
// (as window.Rollover) and in Node (module.exports) for tests.
//
// Units: dollars in trillions, rates and ratios in percent, one turn = one
// two-year Congress.
(function (root) {
  const Events = (typeof module !== 'undefined' && module.exports)
    ? require('./events.js')
    : root.RolloverEvents;
  const EVENTS = Events.EVENTS;
  const BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

  const TURNS = 10;
  const YEARS = 2;             // years per turn
  const LONG_TURNS = 5;        // 10-year bonds mature after 5 turns
  const START_YEAR = 2027;
  const FIRST_CONGRESS = 120;
  const R_STAR = 0.75;         // neutral real rate
  const INF_TARGET = 2;
  const LONG_NEUTRAL = 4.2;    // 10y level that neither helps nor hurts the economy
  const CRISIS_INT_REV = 35;   // lose if interest exceeds this % of revenue
  const MAX_STRIKES = 2;       // lose after this many failed auctions
  const START_GDP = 30;

  // Baseline appetite of each buyer group, % of GDP. Short appetite is how
  // many bills they're willing to hold; long appetite is how many new
  // 10-year bonds they'll buy over one turn.
  const BUYERS = [
    { id: 'mmf', name: 'Money market funds', s: 18, l: 0 },
    { id: 'banks', name: 'Banks', s: 6, l: 6 },
    { id: 'foreign', name: 'Foreign buyers', s: 6, l: 10 },
    { id: 'pensions', name: 'Pensions & insurers', s: 0, l: 8 },
    { id: 'fed', name: 'Federal Reserve', s: 0, l: 0 },
  ];

  // ---- randomness ------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const has = (e, tag) => (e.tags || []).includes(tag);

  function randomSeed() {
    return Math.floor(Math.random() * 900000) + 100000;
  }

  // ---- world generation ----------------------------------------------
  // The whole world (events, shocks, starting point) is drawn up front from
  // the seed, so the same seed replays the same history no matter what the
  // player does. That makes strategy comparisons fair.
  function createWorld(seed) {
    seed = Math.floor(Math.abs(seed)) || 1;
    const rng = mulberry32(seed);
    const start = {
      debtRatio: lerp(0.84, 0.96, rng()),
      inf: lerp(2.3, 3.3, rng()),
      gap: lerp(-0.4, 0.9, rng()),
      spend: lerp(19.3, 20.1, rng()),
      shortShare: lerp(0.24, 0.34, rng()),
    };
    const used = {};
    let sawDownturn = false;
    let sawInflation = false;
    let prev = [];
    const turns = [];
    for (let t = 0; t < TURNS; t++) {
      const count = t > 0 && rng() < 0.35 ? 2 : 1;
      const picks = [];
      for (let k = 0; k < count; k++) {
        let forced = null;
        if (k === 0 && t === 6 && !sawDownturn) forced = 'downturn';
        if (k === 0 && t === 7 && !sawInflation) forced = 'inflation';
        const prevDown = prev.some((e) => has(e, 'downturn'));
        const prevSpend = prev.some((e) => e.id === 'stimulus' || e.id === 'defense' || e.id === 'tax_cut');
        const pool = EVENTS.filter((e) =>
          (used[e.id] || 0) < (e.max || 1) &&
          !prev.some((p) => p.id === e.id) &&
          !picks.some((p) => BY_ID[p.id].cat === e.cat) &&
          (!forced || has(e, forced)));
        const weights = pool.map((e) => {
          let w = e.weight;
          if (has(e, 'followsDownturn')) w *= prevDown ? 6 : 0.15;
          if (has(e, 'inflation') && prevSpend) w *= 2;
          if (e.id === 'recession' && prev.some((p) => p.id === 'boom')) w *= 2.5;
          if (t === 0 && has(e, 'downturn')) w *= 0.3;
          return w;
        });
        let r = rng() * sum(weights);
        let chosen = pool[pool.length - 1];
        for (let i = 0; i < pool.length; i++) {
          r -= weights[i];
          if (r <= 0) { chosen = pool[i]; break; }
        }
        used[chosen.id] = (used[chosen.id] || 0) + 1;
        if (has(chosen, 'downturn')) sawDownturn = true;
        if (has(chosen, 'inflation')) sawInflation = true;
        picks.push({ id: chosen.id, scale: lerp(0.75, 1.25, rng()) });
      }
      prev = picks.map((p) => BY_ID[p.id]);
      turns.push({
        events: picks,
        noise: { gap: gauss(rng), inf: gauss(rng), fed: gauss(rng) },
      });
    }
    return { seed, start, turns };
  }

  // ---- market pricing --------------------------------------------------
  function fedTarget(inf, gap) {
    return R_STAR + inf + 0.5 * (inf - INF_TARGET) + 0.5 * gap;
  }

  // What markets expect the Fed's rate to average over the next ten years:
  // part today's rate, mostly where they think it settles.
  function expectedPath(fedRate, inf) {
    return 0.35 * fedRate + 0.65 * (R_STAR + INF_TARGET + 0.4 * (inf - INF_TARGET));
  }

  function termPremium({ debtRatio, inf, pressureL, intRev, tpShock }) {
    const parts = {
      base: 0.3,
      debt: 1.8 * (debtRatio - 1.0),
      inflation: 0.3 * Math.abs(inf - INF_TARGET),
      supply: pressureL > 0 ? 1.3 * pressureL : 0.5 * Math.max(pressureL, -0.6),
      burden: intRev > 20 ? 0.05 * (intRev - 20) : 0,
      shock: tpShock,
    };
    parts.total = sum(Object.values(parts));
    return parts;
  }

  function annualInterest(shortStock, shortRate, vintages) {
    return shortStock * shortRate / 100 + sum(vintages.map((v) => v.amount * v.rate / 100));
  }

  function revenuePct(st, gap) {
    return 17.5 + 0.25 * gap + st.revenueAdj;
  }

  // ---- game state ------------------------------------------------------
  function newGame(world) {
    const s0 = world.start;
    const gdp = START_GDP;
    const debt = s0.debtRatio * gdp;
    const shortStock = debt * s0.shortShare;
    const longStock = debt - shortStock;
    // Coupons on 10-year notes issued roughly 2017, 2019, 2021, 2023, 2025.
    const coupons = [2.4, 2.0, 1.6, 4.0, 4.4];
    const vintages = coupons.map((rate, i) => ({ amount: longStock / LONG_TURNS, rate, matures: i }));
    const fedRate = roundFed(fedTarget(s0.inf, s0.gap));
    const shortRate = fedRate + 0.1;
    const st = {
      turn: 0,
      gdp, debt, shortStock, shortRate, vintages,
      spend: s0.spend, revenueAdj: 0, lastSpendTemp: 0,
      gap: s0.gap, inf: s0.inf, growth: 1.8, unemp: 4.2 - 0.5 * s0.gap,
      fedRate,
      tpShock: 0, lastDy10: 0,
      buyerMods: {},
      strikes: 0, interestPaid: 0,
      over: false, won: false, lossReason: null,
      history: [], brief: null,
    };
    st.intRev = annualInterest(shortStock, shortRate, vintages) / (revenuePct(st, st.gap) / 100 * gdp) * 100;
    st.tp = termPremium({ debtRatio: debt / gdp, inf: st.inf, pressureL: 0, intRev: st.intRev, tpShock: 0 });
    st.expPath = expectedPath(fedRate, st.inf);
    st.y10 = st.expPath + st.tp.total;
    st.y1 = shortRate;
    st.initial = snapshot(st, null);
    return st;
  }

  function roundFed(x) {
    return Math.max(0.25, Math.round(x * 4) / 4);
  }

  function longStockOf(st) {
    return sum(st.vintages.map((v) => v.amount));
  }

  function avgMaturity(st, t) {
    const longYears = sum(st.vintages.map((v) => v.amount * Math.max(0.5, (v.matures - t) * YEARS)));
    return (st.shortStock * 0.5 + longYears) / st.debt;
  }

  function snapshot(st, extra) {
    return Object.assign({
      turn: st.turn,
      year: START_YEAR + st.turn * YEARS,
      fedRate: st.fedRate, y1: st.y1, y10: st.y10,
      expPath: st.expPath, tp: st.tp,
      inf: st.inf, gap: st.gap, growth: st.growth, unemp: st.unemp,
      debt: st.debt, gdp: st.gdp, debtRatio: st.debt / st.gdp * 100,
      shortStock: st.shortStock, longStock: longStockOf(st),
      shortShareOfDebt: st.shortStock / st.debt * 100,
      intRev: st.intRev,
      avgMaturity: avgMaturity(st, st.turn),
      interestPaid: st.interestPaid,
    }, extra || {});
  }

  function buyerDemand(st, gdp, fedRate, bs) {
    const rows = BUYERS.map((b) => {
      const mod = st.buyerMods[b.id] || { s: 0, l: 0 };
      let s = b.s * (1 + mod.s);
      let l = b.l * (1 + mod.l);
      const notes = [];
      if (b.id === 'mmf') s *= 1 + 0.06 * (fedRate - 3.5);
      if (b.id === 'banks' && st.lastDy10 > 0.15) {
        l *= Math.max(0.2, 1 - 0.6 * st.lastDy10);
        notes.push('losses on old bonds');
      }
      if (b.id === 'pensions') {
        const f = clamp(1 + 0.2 * (st.y10 - 4.3), 0.5, 1.8);
        l *= f;
        if (f > 1.1) notes.push('high yields attract them');
        if (f < 0.9) notes.push('yields too low to excite them');
      }
      if (b.id === 'fed') {
        if (bs === 'QE') { s = 3; l = 7; notes.push('QE: buying bonds'); }
        if (bs === 'QT') { l = -2.5; notes.push('QT: letting bonds run off'); }
      }
      if (mod.s > 0.08 || mod.l > 0.08) notes.unshift('event: buying more');
      if (mod.s < -0.08 || mod.l < -0.08) notes.unshift('event: pulling back');
      const scale = gdp / 100;
      return {
        id: b.id, name: b.name,
        s: Math.max(0, s) * scale,
        l: (b.id === 'fed' ? l : Math.max(0, l)) * scale,
        notes,
      };
    });
    return {
      rows,
      capS: Math.max(1, sum(rows.map((r) => r.s))),
      capL: Math.max(0.8, sum(rows.map((r) => r.l))),
    };
  }

  // Start of a turn: apply this turn's events, move the economy, let the Fed
  // act, and tell the player how much Congress needs.
  function beginTurn(st, world) {
    const t = st.turn;
    const T = world.turns[t];
    const events = T.events.map((p) => Object.assign({}, BY_ID[p.id], { scale: p.scale }));

    let spendTemp = 0, gapShock = 0, infShock = 0, fedShift = 0, impulse = 0;
    for (const ev of events) {
      const f = ev.fx, k = ev.scale;
      st.spend += (f.spend || 0) * k;
      st.revenueAdj += (f.revenue || 0) * k;
      spendTemp += (f.spendTemp || 0) * k;
      gapShock += (f.gap || 0) * k;
      infShock += (f.inf || 0) * k;
      fedShift += (f.fedShift || 0) * k;
      st.tpShock += (f.tp || 0) * k;
      impulse += ((f.spend || 0) + (f.spendTemp || 0) - (f.revenue || 0)) * k;
      for (const [id, m] of Object.entries(f.buyers || {})) {
        const mod = st.buyerMods[id] || (st.buyerMods[id] = { s: 0, l: 0, decay: 0.5 });
        mod.s += (m.s || 0) * k;
        mod.l += (m.l || 0) * k;
        mod.decay = Math.max(mod.decay, f.decay || 0.5);
      }
    }
    impulse -= st.lastSpendTemp;
    st.lastSpendTemp = spendTemp;

    // Economy
    const prevGap = st.gap, prevFed = st.fedRate;
    const realRate = st.fedRate - st.inf;
    st.gap = clamp(
      0.45 * prevGap + gapShock - 0.35 * (realRate - R_STAR) - 0.25 * (st.y10 - LONG_NEUTRAL) +
      0.3 * impulse + 0.5 * T.noise.gap, -8, 6);
    st.inf = clamp(0.45 * st.inf + 0.55 * INF_TARGET + 0.3 * st.gap + infShock + 0.3 * T.noise.inf, -1.5, 12);
    st.growth = clamp(1.8 + (st.gap - prevGap) / YEARS, -6, 8);
    st.unemp = clamp(4.2 - 0.5 * st.gap, 2.8, 14);

    // Fed: a Taylor-style rule, smoothed, with a little noise and surprises.
    const target = fedTarget(st.inf, st.gap);
    st.fedRate = roundFed(0.35 * prevFed + 0.65 * target + 0.25 * T.noise.fed + fedShift);
    const bs = st.gap < -2 && st.fedRate <= 1.0 ? 'QE' : st.inf > 3 ? 'QT' : 'Steady';
    const fedReason = describeFed(prevFed, st.fedRate, st.inf, st.unemp, fedShift);

    // Budget
    const rev = revenuePct(st, st.gap);
    const spendNow = st.spend + spendTemp - 0.15 * st.gap;
    const primaryPct = spendNow - rev;
    const gdpEnd = st.gdp * Math.pow(1 + (st.growth + st.inf) / 100, YEARS);
    const gdpAvg = (st.gdp + gdpEnd) / 2;
    const billRate = st.fedRate + 0.1;
    const intAnnual = annualInterest(st.shortStock, billRate, st.vintages);
    const primary = primaryPct / 100 * gdpAvg * YEARS;
    const interest = intAnnual * YEARS;
    const rollLong = sum(st.vintages.filter((v) => v.matures === t).map((v) => v.amount));
    const rollShort = st.shortStock;
    const need = Math.max(0.5, primary + interest + rollShort + rollLong);

    const demand = buyerDemand(st, gdpEnd, st.fedRate, bs);

    st.brief = {
      turn: t,
      congress: FIRST_CONGRESS + t,
      years: [START_YEAR + t * YEARS, START_YEAR + t * YEARS + YEARS - 1],
      events,
      econ: { growth: st.growth, inf: st.inf, unemp: st.unemp, gap: st.gap },
      fed: { rate: st.fedRate, prev: prevFed, reason: fedReason, bs },
      budget: { spendPct: spendNow, revenuePct: rev, primaryPct, deficitPct: (primary + interest) / gdpAvg / YEARS * 100 },
      need: { primary, interest, rollShort, rollLong, total: need },
      demand,
      gdpEnd, rev,
    };
    return st.brief;
  }

  function describeFed(prev, now, inf, unemp, shift) {
    const d = now - prev;
    const move = Math.abs(d) < 0.01 ? 'held rates at ' + now.toFixed(2) + '%'
      : (d > 0 ? 'raised' : 'cut') + ' rates from ' + prev.toFixed(2) + '% to ' + now.toFixed(2) + '%';
    let why;
    if (shift > 0.3) why = 'a hawkish new leadership wants to stamp out inflation';
    else if (shift < -0.3) why = 'it is under pressure to support the economy';
    else if (inf > 3 && d >= 0) why = 'inflation is ' + inf.toFixed(1) + '%, well above its 2% target';
    else if (unemp > 5.5 && d <= 0) why = 'unemployment has climbed to ' + unemp.toFixed(1) + '%';
    else if (d > 0) why = 'the economy is running hot';
    else if (d < 0) why = 'inflation is cooling and growth is soft';
    else why = 'inflation and jobs look roughly balanced';
    return 'The Fed ' + move + ' because ' + why + '.';
  }

  // Preview what the auction will look like at a given long share, without
  // revealing exact yields.
  function previewAuction(st, longShare) {
    const b = st.brief;
    const L = longShare * b.need.total;
    const S = b.need.total - L;
    const pressureL = (L - b.demand.capL) / b.demand.capL;
    const pressureS = (S - b.demand.capS) / b.demand.capS;
    return { L, S, pressureL, pressureS, longStatus: auctionStatus(pressureL), shortStatus: auctionStatus(pressureS, true) };
  }

  function auctionStatus(p, isShort) {
    if (!isShort && p > 1.0) return 'fail';
    if (p > (isShort ? 0.5 : 0.3)) return 'weak';
    if (p > 0.1) return 'tail';
    if (p < -0.15) return 'strong';
    return 'ok';
  }

  // Player decides; markets clear; the debt and economy update.
  function resolveTurn(st, longShare) {
    const t = st.turn;
    const b = st.brief;
    longShare = clamp(longShare, 0, 1);
    const prevY10 = st.y10, prevY1 = st.y1, prevTp = st.tp, prevExp = st.expPath, prevIntRev = st.intRev;
    const pv = previewAuction(st, longShare);
    const { L, S, pressureL, pressureS } = pv;

    const failed = pressureL > 1.0;
    if (failed) { st.strikes += 1; }

    const debtRatioStart = st.debt / st.gdp;
    st.tp = termPremium({ debtRatio: debtRatioStart, inf: st.inf, pressureL, intRev: st.intRev, tpShock: st.tpShock + (failed ? 0.8 : 0) });
    st.expPath = expectedPath(st.fedRate, st.inf);
    st.y10 = Math.max(0.3, st.expPath + st.tp.total);
    const shortSpread = clamp(0.45 * pressureS, -0.25, 1.5);
    st.y1 = Math.max(0.05, st.fedRate + 0.1 + shortSpread);

    // Books
    st.vintages = st.vintages.filter((v) => v.matures !== t);
    if (L > 0.001) st.vintages.push({ amount: L, rate: st.y10, matures: t + LONG_TURNS });
    st.shortStock = S;
    st.shortRate = st.y1;
    st.debt += b.need.primary + b.need.interest;
    st.gdp = b.gdpEnd;
    st.interestPaid += b.need.interest;
    const revenue = b.rev / 100 * st.gdp;
    st.intRev = annualInterest(st.shortStock, st.y1, st.vintages) / revenue * 100;

    // Fade temporary forces
    st.tpShock = (st.tpShock + (failed ? 0.8 : 0)) * 0.5;
    for (const mod of Object.values(st.buyerMods)) {
      mod.s *= mod.decay; mod.l *= mod.decay;
    }
    st.lastDy10 = st.y10 - prevY10;

    const auction = {
      L, S, pressureL, pressureS,
      longStatus: auctionStatus(pressureL), shortStatus: auctionStatus(pressureS, true),
      capL: b.demand.capL, capS: b.demand.capS,
      tailBp: pressureL > 0.1 ? Math.round(1.3 * pressureL * 100) : 0,
      failed,
    };

    const lines = debrief({
      st, b, auction, longShare, prevY10, prevY1, prevTp, prevExp, prevIntRev,
    });

    st.turn += 1;
    if (st.intRev > CRISIS_INT_REV) { st.over = true; st.lossReason = 'interest'; }
    else if (st.strikes >= MAX_STRIKES) { st.over = true; st.lossReason = 'auctions'; }
    else if (st.turn >= TURNS) { st.over = true; st.won = true; }

    const entry = snapshot(st, { longShare, auction, lines, events: b.events.map((e) => e.id), congress: b.congress });
    entry.turn = t;
    entry.year = b.years[1] + 1;
    st.history.push(entry);
    st.brief = null;
    return entry;
  }

  const TP_LABELS = {
    supply: 'the amount of long bonds you sold',
    debt: 'the rising debt load',
    inflation: 'inflation uncertainty',
    burden: 'worries about the interest burden',
    shock: 'market turmoil from events',
  };

  function debrief({ st, b, auction, longShare, prevY10, prevY1, prevTp, prevExp, prevIntRev }) {
    const lines = [];
    const fmt = (x) => '$' + x.toFixed(1) + 'T';
    // Auction
    if (auction.failed) {
      lines.push({ tone: 'bad', text: 'Failed auction. You offered ' + fmt(auction.L) + ' of 10-year bonds but buyers only wanted about ' + fmt(auction.capL) + '. Dealers were stuck with the rest, yields spiked, and markets will remember. (' + st.strikes + ' of ' + MAX_STRIKES + ' strikes)' });
    } else if (auction.pressureL > 0.1) {
      lines.push({ tone: 'warn', text: 'The 10-year auction tailed. You sold ' + fmt(auction.L) + ' into about ' + fmt(auction.capL) + ' of demand, so buyers demanded about ' + auction.tailBp + ' basis points of extra yield.' });
    } else if (auction.pressureL < -0.15) {
      lines.push({ tone: 'good', text: 'Strong 10-year auction. Buyers wanted about ' + fmt(auction.capL) + ' and you sold only ' + fmt(auction.L) + ', so they competed and kept yields low.' });
    } else {
      lines.push({ tone: 'neutral', text: 'The 10-year auction went smoothly: ' + fmt(auction.L) + ' sold against about ' + fmt(auction.capL) + ' of demand.' });
    }
    if (auction.pressureS > 0.5) {
      lines.push({ tone: 'warn', text: 'You leaned hard on bills: ' + fmt(auction.S) + ' outstanding against about ' + fmt(auction.capS) + ' of demand. Bill yields rose above the Fed rate to attract buyers.' });
    }

    // 10-year decomposition
    const d10 = st.y10 - prevY10;
    const dExp = st.expPath - prevExp;
    const dTp = st.tp.total - prevTp.total;
    if (Math.abs(d10) >= 0.1) {
      let driver = null, best = 0;
      for (const k of Object.keys(TP_LABELS)) {
        const dk = st.tp[k] - prevTp[k];
        if (Math.abs(dk) > Math.abs(best)) { best = dk; driver = k; }
      }
      const dir = d10 > 0 ? 'rose' : 'fell';
      let text = 'The 10-year yield ' + dir + ' ' + Math.abs(d10).toFixed(2) + ' pts to ' + st.y10.toFixed(2) + '%. ';
      text += 'Expected Fed path: ' + sign(dExp) + ' pts. Term premium: ' + sign(dTp) + ' pts';
      if (driver && Math.abs(best) >= 0.1) text += ', mostly from ' + TP_LABELS[driver];
      text += '.';
      if (st.fedRate < b.fed.prev && d10 > 0.1) text += ' The Fed cut, yet long rates rose. The Fed only controls the short end.';
      lines.push({ tone: d10 > 0 ? 'warn' : 'good', text });
    } else {
      lines.push({ tone: 'neutral', text: 'The 10-year yield barely moved, ending at ' + st.y10.toFixed(2) + '%.' });
    }

    // Short-debt exposure
    const shortShare = st.shortStock / st.debt * 100;
    const perPoint = st.shortStock * 0.01 * 1000;
    if (shortShare > 40) {
      lines.push({ tone: 'warn', text: Math.round(shortShare) + '% of the debt is now in bills. Every 1 pt the Fed hikes adds about $' + Math.round(perPoint) + 'B a year in interest.' });
    }

    // Interest burden
    const dIR = st.intRev - prevIntRev;
    lines.push({
      tone: st.intRev > 25 ? 'bad' : dIR > 1 ? 'warn' : 'neutral',
      text: 'Interest now takes ' + st.intRev.toFixed(1) + '% of federal revenue (' + (dIR >= 0 ? 'up ' : 'down ') + Math.abs(dIR).toFixed(1) + ' pts). Debt is ' + (st.debt / st.gdp * 100).toFixed(0) + '% of GDP.',
    });
    return lines;
  }

  function sign(x) {
    return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
  }

  // Play a whole game with a fixed rule. Used for end-of-game comparisons.
  function simulate(world, chooseShare) {
    const st = newGame(world);
    while (!st.over) {
      beginTurn(st, world);
      resolveTurn(st, chooseShare(st));
    }
    return st;
  }

  const STRATEGIES = [
    { id: 'bills', name: 'All bills', share: 0 },
    { id: 'balanced', name: 'Balanced (35% long)', share: 0.35 },
    { id: 'long', name: 'Mostly long (70%)', share: 0.7 },
  ];

  const api = {
    TURNS, YEARS, START_YEAR, FIRST_CONGRESS, CRISIS_INT_REV, MAX_STRIKES, BUYERS, STRATEGIES,
    EVENTS, BY_ID,
    createWorld, newGame, beginTurn, previewAuction, resolveTurn, simulate, randomSeed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rollover = api;
})(typeof self !== 'undefined' ? self : this);
