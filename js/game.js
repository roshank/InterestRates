// Rollover UI. Reads state from the sim engine (window.Rollover) and renders
// the Treasury desk. Game state is fully determined by the world seed plus
// the list of decisions, which is what we snapshot and restore.
(function () {
  const R = window.Rollover;
  const $ = (sel) => document.querySelector(sel);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fmtT = (x) => '$' + x.toFixed(1) + 'T';
  const pct = (x, d = 1) => x.toFixed(d) + '%';
  const arrow = (d, eps = 0.01) => (d > eps ? '▲' : d < -eps ? '▼' : '■');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let world = null;
  let st = null;
  let brief = null;        // briefing for the turn on screen
  let lastEntry = null;    // result of the turn just resolved
  let decisions = [];
  let phase = 'intro';     // intro | decide | result | end
  let share = 0.35;
  let prevBrief = null;    // last turn's briefing, for comparisons

  // ---- game flow -------------------------------------------------------
  function startGame(seed, replay) {
    world = R.createWorld(seed);
    st = R.newGame(world);
    decisions = [];
    lastEntry = null;
    share = 0.35;
    for (const d of replay || []) {
      brief = R.beginTurn(st, world);
      lastEntry = R.resolveTurn(st, d);
      decisions.push(d);
      share = d;
    }
    $('#seedLabel').textContent = 'World #' + world.seed;
    hide('#intro'); hide('#end'); hide('#news');
  }

  function nextTurn() {
    prevBrief = brief && st.turn > 0 ? brief : null;
    brief = R.beginTurn(st, world);
    phase = 'decide';
    render();
    window.scrollTo({ top: 0 });
    openNews();
  }

  function issue() {
    if (phase !== 'decide') return;
    lastEntry = R.resolveTurn(st, share);
    decisions.push(share);
    phase = 'result';
    render();
    const btn = $('#nextBtn');
    if (btn) btn.focus({ preventScroll: true });
  }

  function advance() {
    if (st.over) { phase = 'end'; render(); showEnd(); }
    else nextTurn();
  }

  // ---- the morning paper -------------------------------------------------
  // Each turn opens with a newspaper: a color-coded summary of what changed
  // and what it means for the Treasury, then headlines with optional detail.
  // Dismissing it shrinks the paper into the briefing panel on the desk.
  const range = (r) => '$' + r[0].toFixed(1) + '–' + r[1].toFixed(1) + 'T';
  const signed = (d, digits = 1) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(digits);
  const delta = (d, eps, digits = 1, unit = '') =>
    Math.abs(d) < eps ? '■ no change' : arrow(d) + ' ' + signed(d, digits) + unit;

  // Six tiles: value, direction, and what it means for you. Tone is from the
  // Treasury's point of view (good = cheaper or easier borrowing).
  function summaryTiles(b) {
    const prev = b.turn === 0 ? st.initial : st.history[b.turn - 1];
    const tiles = [];
    const flat = (d, eps) => Math.abs(d) < eps;

    const dn = prevBrief ? b.need.total - prevBrief.need.total : null;
    tiles.push({
      label: 'To borrow', value: fmtT(b.need.total),
      delta: dn === null ? '' : delta(dn, 0.05, 1, 'T'),
      tone: dn === null ? 'neutral' : dn > 0.2 ? 'bad' : dn < -0.2 ? 'good' : 'neutral',
      effect: dn === null ? 'deficit plus debt coming due' : dn > 0.2 ? 'more to raise than last time' : dn < -0.2 ? 'less to raise than last time' : 'about the same as last time',
    });

    const df = b.fed.rate - b.fed.prev;
    tiles.push({
      label: 'Fed rate', value: pct(b.fed.rate, 2), delta: delta(df, 0.01, 2),
      tone: flat(df, 0.01) ? 'neutral' : df > 0 ? 'bad' : 'good',
      effect: flat(df, 0.01) ? 'bill costs steady' : df > 0 ? 'bills cost more' : 'bills get cheaper',
    });

    const di = b.econ.inf - prev.inf;
    tiles.push({
      label: 'Inflation', value: pct(b.econ.inf), delta: delta(di, 0.05),
      tone: b.econ.inf > 3.5 || di > 0.4 ? 'bad' : di < -0.4 && b.econ.inf > 1 ? 'good' : 'neutral',
      effect: b.econ.inf > 3.5 ? 'Fed will stay tight' : di > 0.4 ? 'Fed may hike' : di < -0.4 ? 'room for the Fed to ease' : 'close to the 2% target',
    });

    const dg = b.econ.growth - prev.growth;
    tiles.push({
      label: 'Growth', value: pct(b.econ.growth), delta: delta(dg, 0.05),
      tone: b.econ.growth < 1 ? 'bad' : b.econ.growth > 2.2 ? 'good' : 'neutral',
      effect: b.econ.growth < 1 ? 'tax revenue falls, deficit grows' : b.econ.growth > 2.2 ? 'tax revenue rises' : 'revenue on trend',
    });

    const buyerTile = (label, now, before, rng, kind) => {
      const d = before ? (now - before) / before : null;
      return {
        label, value: range(rng), delta: d === null ? 'estimate' : delta(d * 100, 0.5, 0, '%'),
        tone: d === null ? 'neutral' : d > 0.03 ? 'good' : d < -0.03 ? 'bad' : 'neutral',
        effect: d === null ? 'what dealers expect' : d > 0.03 ? 'easier to sell ' + kind : d < -0.03 ? 'harder to sell ' + kind : 'demand steady',
      };
    };
    tiles.push(buyerTile('Bond buyers', b.demand.capL, prevBrief && prevBrief.demand.capL, b.demand.rangeL, 'bonds'));
    tiles.push(buyerTile('Bill buyers', b.demand.capS, prevBrief && prevBrief.demand.capS, b.demand.rangeS, 'bills'));

    return '<div class="tiles">' + tiles.map((t) =>
      '<div class="tile t-' + t.tone + '"><span class="label">' + t.label + '</span>' +
      '<div class="tv"><span class="num">' + t.value + '</span> <span class="td num">' + esc(t.delta) + '</span></div>' +
      '<div class="te">' + esc(t.effect) + '</div></div>').join('') + '</div>';
  }

  function stories(b) {
    const out = b.events.map((e) => ({
      kicker: e.cat, head: e.title, dek: e.text,
      body: '<p><b>Why it matters:</b> ' + esc(e.lesson) + '</p>' +
        (e.example ? '<p class="example"><span class="label">Real world</span> ' + esc(e.example) + '</p>' : ''),
    }));

    const df = b.fed.rate - b.fed.prev;
    out.push({
      kicker: 'The Fed',
      head: Math.abs(df) < 0.01 ? 'Fed holds rates at ' + pct(b.fed.rate, 2) : (df > 0 ? 'Fed raises rates to ' : 'Fed cuts rates to ') + pct(b.fed.rate, 2),
      dek: b.fed.reason,
      body: '<p>' + (b.fed.bs === 'QE' ? 'The Fed is also buying bonds (QE), adding demand for your debt.' : b.fed.bs === 'QT' ? 'The Fed is also letting its bonds run off (QT), so private buyers must absorb more.' : 'The Fed\'s bond holdings are steady.') + '</p>' +
        '<p><b>Why it matters:</b> Bills pay roughly the Fed\'s rate, so every move reprices your short-term debt right away. Long rates follow where markets expect the Fed to go.</p>',
    });

    const e = b.econ;
    const head = e.growth < 0 ? 'Economy shrinks; unemployment hits ' + pct(e.unemp)
      : e.inf > 4 ? 'Inflation runs hot at ' + pct(e.inf)
      : e.growth < 1 ? 'Economy stalls at ' + pct(e.growth) + ' growth'
      : e.growth > 2.6 ? 'Economy booms with ' + pct(e.growth) + ' growth'
      : 'Steady economy: ' + pct(e.growth) + ' growth, ' + pct(e.inf) + ' inflation';
    out.push({
      kicker: 'Economy', head,
      dek: 'Unemployment ' + pct(e.unemp) + ', inflation ' + pct(e.inf) + '.' +
        (e.drivers.length ? ' Biggest forces: ' + e.drivers.map((d) => d.label).join('; ') + '.' : ''),
      body: econHTML(b),
    });

    const movers = b.demand.rows.filter((r) => r.notes.length);
    const back = movers.find((r) => r.notes.some((n) => /pulling back|losses/.test(n)));
    const more = movers.find((r) => r.notes.some((n) => /buying more|QE/.test(n)));
    out.push({
      kicker: 'Bond market',
      head: back ? back.name + ' pull back from Treasuries' : more ? more.name + ' step up buying' : 'Bond demand seen at ' + range(b.demand.rangeL),
      dek: 'Dealers estimate buyers will take ' + range(b.demand.rangeL) + ' of new bonds and hold ' + range(b.demand.rangeS) + ' of bills. The real number shows up at the auction.',
      body: buyersSummaryHTML(b),
    });
    return out;
  }

  function openNews() {
    const b = brief;
    const st0 = stories(b);
    $('#newsSheet').innerHTML =
      '<header class="masthead">' +
      '<div class="mast-line"><span>Vol. ' + (b.turn + 1) + ' of ' + R.TURNS + '</span><span>' + b.congress + 'th Congress</span><span>' + b.years[0] + '–' + b.years[1] + '</span></div>' +
      '<h2 id="newsTitle">The Treasury Ledger</h2></header>' +
      '<section class="glance"><span class="label">What this means for you</span>' + summaryTiles(b) + '</section>' +
      '<div class="stories">' + st0.map((x, i) =>
        '<article class="story' + (i === 0 ? ' lead' : '') + '">' +
        '<span class="kicker">' + esc(x.kicker) + '</span>' +
        '<h3>' + esc(x.head) + '</h3>' +
        '<p class="dek">' + esc(x.dek) + '</p>' +
        '<details><summary>Read more</summary><div class="more">' + x.body + '</div></details>' +
        '</article>').join('') + '</div>' +
      '<div class="actions"><button class="primary" id="newsBtn" type="button">To the desk →</button></div>';
    show('#news');
    const sheet = $('#newsSheet');
    sheet.scrollTop = 0;
    if (!reduceMotion && sheet.animate) {
      sheet.animate([{ opacity: 0, transform: 'translateY(16px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
    $('#newsBtn').addEventListener('click', closeNews);
    $('#newsBtn').focus({ preventScroll: true });
  }

  function closeNews() {
    const overlay = $('#news');
    if (overlay.hidden) return;
    const sheet = $('#newsSheet');
    const target = $('#brief');
    const done = () => hide('#news');
    if (reduceMotion || !sheet.animate) { done(); return; }
    const from = sheet.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    const s = Math.min(to.width / from.width, to.height / from.height);
    overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
    sheet.animate([{ transform: 'none' }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')' }],
      { duration: 320, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }).onfinish = () => {
      sheet.getAnimations().forEach((a) => a.cancel());
      overlay.getAnimations().forEach((a) => a.cancel());
      done();
    };
  }

  // ---- render ------------------------------------------------------------
  function render() {
    renderTrack();
    renderBrief();
    renderNeed();
    renderAct();
    renderMarket();
    renderBuyers();
  }

  function renderTrack() {
    const cells = [];
    for (let t = 0; t < R.TURNS; t++) {
      const h = st.history[t];
      let cls = 'cell';
      if (h) cls += h.auction.failed ? ' fail' : h.auction.pressureL > 0.1 || h.intRev > 28 ? ' hurt' : ' done';
      else if (t === st.turn && phase === 'decide') cls += ' now';
      const y = R.START_YEAR + t * R.YEARS;
      cells.push('<div class="' + cls + '"><b>' + (R.FIRST_CONGRESS + t) + 'th</b>' + y + '</div>');
    }
    $('#track').innerHTML = cells.join('');
  }

  function renderBrief() {
    const b = brief;
    if (!b) { $('#brief').innerHTML = ''; return; }
    $('#brief').innerHTML =
      '<div class="congress"><h2>' + b.congress + 'th Congress</h2><span class="label">' + b.years[0] + '–' + b.years[1] + ' · Turn ' + (b.turn + 1) + ' of ' + R.TURNS + '</span></div>' +
      summaryTiles(b) +
      '<ul class="headlines">' + stories(b).map((x) => '<li><span class="kicker">' + esc(x.kicker) + '</span> ' + esc(x.head) + '</li>').join('') + '</ul>' +
      (phase === 'decide' ? '<button class="chipbtn reopen" id="reopenBtn" type="button">Open the paper</button>' : '');
    const re = $('#reopenBtn');
    if (re) re.addEventListener('click', openNews);
  }

  function econHTML(b) {
    const prev = b.turn === 0 ? st.initial : st.history[b.turn - 1];
    const stat = (label, v, d, invert) => {
      const cls = Math.abs(d) < 0.05 ? '' : (d > 0) !== !!invert ? 'up' : 'down';
      return '<div class="stat"><span class="label">' + label + '</span><div class="v">' + pct(v) + '</div>' +
        '<div class="d ' + cls + '">' + arrow(d, 0.05) + ' ' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '</div></div>';
    };
    const bsTone = b.fed.bs === 'QE' ? 'tone-good' : b.fed.bs === 'QT' ? 'tone-warn' : 'tone-neutral';
    const bsText = b.fed.bs === 'QE' ? 'QE: Fed buying bonds' : b.fed.bs === 'QT' ? 'QT: Fed shrinking its bonds' : 'Balance sheet steady';
    return '<div class="stats">' +
      stat('Growth', b.econ.growth, b.econ.growth - prev.growth, true) +
      stat('Inflation', b.econ.inf, b.econ.inf - prev.inf) +
      stat('Jobless', b.econ.unemp, b.econ.unemp - prev.unemp) +
      stat('Fed rate', b.fed.rate, b.fed.rate - b.fed.prev) +
      '</div>' +
      '<p class="fedline"><span>' + esc(b.fed.reason) + '</span> <span class="pill ' + bsTone + '">' + bsText + '</span></p>' +
      (b.econ.drivers.length ? '<p class="drivers"><span class="label">Moving the economy</span>' +
        b.econ.drivers.map((d) => '<span class="drv ' + (d.v > 0 ? 'tone-good' : 'tone-warn') + '">' + (d.v > 0 ? '▲ ' : '▼ ') + esc(d.label) + '</span>').join('') + '</p>' : '');
  }

  // What's publicly visible about buyers: who is leaning in or pulling back.
  function buyersSummaryHTML(b) {
    const moves = b.demand.rows.filter((r) => r.notes.length)
      .map((r) => '<li><b>' + esc(r.name) + '</b> ' + esc(r.notes.join(', ')) + '</li>');
    return (moves.length ? '<ul class="buyerlist">' + moves.join('') + '</ul>' : '<p>No big shifts among buyers this turn.</p>') +
      '<p><b>Why it matters:</b> Treasury sees holdings data, dealer surveys and past auctions, so it knows the trend but not the exact number. Sell well inside the estimate to be safe; sell beyond it and yields jump.</p>';
  }

  function renderNeed() {
    const b = brief;
    if (!b) return;
    const n = b.need;
    const parts = [
      { k: 'Deficit spending', v: Math.max(0, n.primary), c: 'var(--fedc)' },
      { k: 'Interest', v: n.interest, c: 'var(--bad)' },
      { k: 'Maturing bills', v: n.rollShort, c: 'var(--bill)' },
      { k: 'Maturing bonds', v: n.rollLong, c: 'var(--bond)' },
    ];
    const tot = parts.reduce((a, p) => a + p.v, 0) || 1;
    const surplus = n.primary < 0 ? '<span>Primary surplus offsets <span class="num">' + fmtT(-n.primary) + '</span></span>' : '';
    $('#need').innerHTML =
      '<div class="needhead"><div><span class="label">Congress needs you to raise</span><div class="big num">' + fmtT(n.total) + '</div></div>' +
      '<div class="label">Deficit ' + pct(b.budget.deficitPct) + ' of GDP / yr</div></div>' +
      '<div class="stack" role="img" aria-label="Breakdown of the borrowing need">' +
      parts.map((p) => '<span style="width:' + (p.v / tot * 100) + '%;background:' + p.c + '"></span>').join('') + '</div>' +
      '<div class="legend">' + parts.map((p) => '<span><i style="background:' + p.c + '"></i>' + p.k + ' <span class="num">' + fmtT(p.v) + '</span></span>').join('') + surplus + '</div>';
  }

  const STATUS = {
    strong: { t: 'Strong demand expected', c: 'tone-good' },
    ok: { t: 'Should clear smoothly', c: 'tone-neutral' },
    tail: { t: 'Likely to tail', c: 'tone-warn' },
    weak: { t: 'Weak: yields likely to jump', c: 'tone-bad' },
    fail: { t: 'Likely to fail', c: 'tone-bad' },
  };

  // The shaded band is the demand estimate; the true amount lands somewhere
  // around it and is revealed at the auction.
  function gauge(id, label, cls, amount, rng, status, color) {
    const max = Math.max(amount, rng[1]) * 1.12 || 1;
    const s = STATUS[status];
    return '<div class="gauge" id="' + id + '">' +
      '<div class="head"><span class="' + cls + '"><b>' + label + '</b> <span class="num">' + fmtT(amount) + '</span> vs buyers ~<span class="num">' + range(rng) + '</span></span>' +
      '<span class="' + s.c + '">' + s.t + '</span></div>' +
      '<div class="bar"><div class="fill" style="width:' + (amount / max * 100) + '%;background:' + color + '"></div>' +
      '<div class="band" style="left:' + (rng[0] / max * 100) + '%;width:' + ((rng[1] - rng[0]) / max * 100) + '%"></div></div></div>';
  }

  function renderAct() {
    if (phase === 'decide') renderDecide();
    else if (phase === 'result' || phase === 'end') renderResult();
  }

  function renderDecide() {
    const pv = R.previewAuction(st, share);
    const longPct = Math.round(share * 100);
    $('#act').innerHTML =
      '<span class="label">Your decision: how do you borrow it?</span>' +
      '<div class="slider-row">' +
      '<div class="side bills"><span class="label bills">Bills</span><span class="num" id="sAmt">' + fmtT(pv.S) + '</span></div>' +
      '<div class="mid" id="mixText">' + (100 - longPct) + ' / ' + longPct + '</div>' +
      '<div class="side bonds right"><span class="label bonds">10-yr bonds</span><span class="num" id="lAmt">' + fmtT(pv.L) + '</span></div>' +
      '</div>' +
      '<input type="range" id="mix" min="0" max="100" step="5" value="' + longPct + '" aria-label="Share of borrowing in 10-year bonds">' +
      '<div class="gauges" id="gauges">' + gauges(pv) + '</div>' +
      '<div class="actions"><button class="primary" id="issueBtn" type="button">Hold the auctions</button></div>' +
      '<p class="hint">The shaded band is the estimate of what buyers want; the real number is revealed at the auction. Selling beyond it pushes yields up. Bills always come due next turn; bonds lock in for five turns.</p>';
    $('#mix').addEventListener('input', onSlide);
    $('#issueBtn').addEventListener('click', issue);
  }

  function gauges(pv) {
    return gauge('gS', 'Bills', 'bills', pv.S, brief.demand.rangeS, pv.shortStatus, 'var(--bill)') +
      gauge('gL', 'Bonds', 'bonds', pv.L, brief.demand.rangeL, pv.longStatus, 'var(--bond)');
  }

  function onSlide(e) {
    share = e.target.value / 100;
    const pv = R.previewAuction(st, share);
    $('#sAmt').textContent = fmtT(pv.S);
    $('#lAmt').textContent = fmtT(pv.L);
    $('#mixText').textContent = (100 - Math.round(share * 100)) + ' / ' + Math.round(share * 100);
    $('#gauges').innerHTML = gauges(pv);
  }

  function renderResult() {
    const h = lastEntry;
    if (!h) return;
    const a = h.auction;
    const tailText = a.failed ? '<span class="tone-bad">Failed: dealers stuck with the excess</span>'
      : a.tailBp > 0 ? '<span class="tone-warn">Tailed ' + a.tailBp + ' bp</span>'
      : a.pressureL < -0.15 ? '<span class="tone-good">Strong demand</span>' : '<span class="tone-neutral">Cleared smoothly</span>';
    const billText = a.pressureS > 0.5 ? '<span class="tone-warn">Bills cheapened to attract buyers</span>' : '<span class="tone-neutral">Priced near the Fed rate</span>';
    const idx = st.history.indexOf(h);
    const prev = idx > 0 ? st.history[idx - 1] : st.initial;
    // Higher yields cost the Treasury more, so up reads as a warning.
    const move = (now, before) => {
      const d = now - before;
      const cls = Math.abs(d) < 0.01 ? 'tone-neutral' : d > 0 ? 'tone-warn' : 'tone-good';
      return '<div class="move ' + cls + '"><span class="arrow" aria-hidden="true">' + arrow(d) + '</span> ' +
        (Math.abs(d) < 0.01 ? 'unchanged' : (d > 0 ? 'up ' : 'down ') + Math.abs(d).toFixed(2) + ' pts') +
        ' <span class="from">from ' + pct(before, 2) + '</span></div>';
    };
    $('#act').innerHTML =
      '<span class="label">Auction results · ' + brief.congress + 'th Congress</span>' +
      '<div class="auction">' +
      '<div class="box"><span class="label bills">Bills · ' + fmtT(a.S) + '</span><div class="y num" data-count="' + h.y1 + '">' + pct(h.y1, 2) + '</div>' + move(h.y1, prev.y1) + '<div class="sub">' + billText + '</div></div>' +
      '<div class="box"><span class="label bonds">10-yr bonds · ' + fmtT(a.L) + '</span><div class="y num" data-count="' + h.y10 + '">' + pct(h.y10, 2) + '</div>' + move(h.y10, prev.y10) + '<div class="sub">' + tailText + '</div></div>' +
      '</div>' +
      '<ul class="lines">' + h.lines.map((l) => '<li class="tone-' + l.tone + '"><span>' + esc(l.text) + '</span></li>').join('') + '</ul>' +
      '<div class="actions"><button class="primary" id="nextBtn" type="button">' + (st.over ? 'See how you did' : 'Next Congress →') + '</button></div>';
    $('#nextBtn').addEventListener('click', advance);
    countUp();
  }

  function countUp() {
    if (reduceMotion) return;
    document.querySelectorAll('[data-count]').forEach((el) => {
      const target = parseFloat(el.dataset.count);
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 700);
        el.textContent = pct(target * (1 - Math.pow(1 - k, 3)), 2);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function renderMarket() {
    const pts = [st.initial].concat(st.history);
    const xs = pts.map((p) => p.year);
    const rates = lineChart({
      xs,
      series: [
        { ys: pts.map((p) => p.fedRate), color: 'var(--fedc)', dash: '4 3' },
        { ys: pts.map((p) => p.y1), color: 'var(--bill)' },
        { ys: pts.map((p) => p.y10), color: 'var(--bond)' },
      ],
      yMin: 0, minSpan: 6,
      label: 'Fed rate, bill yield, and 10-year yield by year',
    });
    const burden = lineChart({
      xs,
      series: [{ ys: pts.map((p) => p.intRev), color: 'var(--bad)' }],
      yMin: 0, minSpan: 40, threshold: { y: R.CRISIS_INT_REV, label: 'crisis ' + R.CRISIS_INT_REV + '%' },
      label: 'Interest as a share of federal revenue by year',
      height: 110,
    });
    const now = pts[pts.length - 1];
    $('#market').innerHTML =
      '<span class="label">Market</span>' +
      '<div class="keys"><span><i style="background:var(--fedc)"></i>Fed rate</span><span><i style="background:var(--bill)"></i>Bill yield</span><span><i style="background:var(--bond)"></i>10-yr yield</span></div>' +
      rates +
      '<span class="label subhead" style="display:block">Interest / revenue</span>' + burden +
      '<div class="metrics">' +
      '<div><span class="label">Debt / GDP</span><span class="num">' + pct(now.debtRatio, 0) + '</span></div>' +
      '<div><span class="label">In bills</span><span class="num">' + pct(now.shortShareOfDebt, 0) + '</span></div>' +
      '<div><span class="label">Avg maturity</span><span class="num">' + now.avgMaturity.toFixed(1) + ' yrs</span></div>' +
      '</div>';
  }

  function niceStep(span) {
    const raw = span / 4;
    const steps = [0.5, 1, 2, 5, 10, 20];
    return steps.find((s) => s >= raw) || 50;
  }

  function lineChart({ xs, series, yMin, minSpan, threshold, label, height }) {
    const W = 340, H = height || 150, padL = 30, padR = 8, padT = 8, padB = 18;
    const all = series.flatMap((s) => s.ys).concat(threshold ? [threshold.y] : []);
    let hi = Math.max(...all, yMin + minSpan);
    const step = niceStep(hi - yMin);
    hi = Math.ceil(hi / step) * step;
    const x0 = R.START_YEAR, x1 = R.START_YEAR + R.TURNS * R.YEARS;
    const X = (x) => padL + (x - x0) / (x1 - x0) * (W - padL - padR);
    const Y = (y) => padT + (1 - (y - yMin) / (hi - yMin)) * (H - padT - padB);
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    for (let y = yMin; y <= hi + 1e-9; y += step) {
      svg += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(y) + '" y2="' + Y(y) + '"/>';
      svg += '<text x="' + (padL - 5) + '" y="' + (Y(y) + 3) + '" text-anchor="end">' + y + '%</text>';
    }
    for (let x = x0; x <= x1; x += 4) {
      svg += '<text x="' + X(x) + '" y="' + (H - 4) + '" text-anchor="middle">' + x + '</text>';
    }
    if (threshold) {
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(threshold.y) + '" y2="' + Y(threshold.y) + '" stroke="var(--bad)" stroke-dasharray="2 3" stroke-width="1"/>';
      svg += '<text x="' + (W - padR) + '" y="' + (Y(threshold.y) - 4) + '" text-anchor="end" style="fill:var(--bad)">' + esc(threshold.label) + '</text>';
    }
    for (const s of series) {
      const d = s.ys.map((y, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(y).toFixed(1)).join(' ');
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/>';
      const i = s.ys.length - 1;
      svg += '<circle cx="' + X(xs[i]) + '" cy="' + Y(s.ys[i]) + '" r="3" fill="' + s.color + '"/>';
    }
    return svg + '</svg>';
  }

  function renderBuyers() {
    const b = brief;
    if (!b) return;
    const rows = b.demand.rows.map((r) =>
      '<tr><td>' + esc(r.name) + (r.notes.length ? '<span class="note">' + esc(r.notes.join(' · ')) + '</span>' : '') + '</td>' +
      '<td class="r num bills">' + (r.s ? '~' + fmtT(r.s) : '–') + '</td>' +
      '<td class="r num bonds">' + (r.l ? (r.l < 0 ? '−' + fmtT(-r.l) : '~' + fmtT(r.l)) : '–') + '</td></tr>').join('');
    $('#buyers').innerHTML =
      '<span class="label">Who buys this turn (estimates)</span>' +
      '<table class="buyers"><thead><tr><th>Buyer</th><th class="r">Bills held</th><th class="r">New bonds</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td>Total appetite</td><td class="r num bills">' + range(b.demand.rangeS) + '</td><td class="r num bonds">' + range(b.demand.rangeL) + '</td></tr></tfoot></table>';
  }

  // ---- end of game -------------------------------------------------------
  function outcomeText(s) {
    if (s.won) return 'Survived';
    const yr = R.START_YEAR + s.history.length * R.YEARS;
    return (s.lossReason === 'auctions' ? 'Buyers\' strike ' : 'Fiscal crisis ') + yr;
  }

  function showEnd() {
    const you = st;
    const rows = [{ name: 'You', s: you, you: true }].concat(
      R.STRATEGIES.map((g) => ({ name: g.name, s: R.simulate(world, () => g.share) })));
    const survivors = rows.filter((r) => r.s.won);
    const best = survivors.length ? Math.min(...survivors.map((r) => r.s.intRev)) : null;

    let title, verdict, tone;
    if (you.won) {
      const beat = rows.filter((r) => !r.you && (!r.s.won || r.s.intRev > you.intRev)).length;
      title = beat === 3 ? 'Masterful debt management' : beat >= 1 ? 'You kept America funded' : 'You made it, barely';
      verdict = 'Survived to 2047'; tone = 'tone-good';
    } else if (you.lossReason === 'auctions') {
      title = 'Buyers went on strike'; verdict = 'Two failed auctions'; tone = 'tone-bad';
    } else {
      title = 'Fiscal crisis'; verdict = 'Interest topped ' + R.CRISIS_INT_REV + '% of revenue'; tone = 'tone-bad';
    }

    const lossLesson = you.won
      ? 'You finished with interest at ' + pct(you.intRev) + ' of revenue and debt at ' + pct(you.debt / you.gdp * 100, 0) + ' of GDP.'
      : you.lossReason === 'auctions'
        ? 'You tried to sell more long bonds than the market would absorb. Real Treasury managers raise bond sizes slowly and announce them months ahead to avoid this.'
        : 'Interest compounds: every dollar of interest you pay is borrowed, and it costs interest too. Heavy reliance on bills makes this spiral faster when the Fed hikes.';

    const seen = [];
    for (const h of you.history) for (const id of h.events) if (!seen.includes(id)) seen.push(id);

    $('#endSheet').innerHTML =
      '<span class="verdict ' + tone + '">' + verdict + '</span>' +
      '<h2 id="endTitle">' + title + '</h2>' +
      '<p class="lead">' + lossLesson + '</p>' +
      '<div><span class="label">Same world, same events: only the borrowing strategy differs</span>' +
      '<div class="tablewrap"><table class="cmp"><thead><tr><th>Strategy</th><th>Outcome</th><th class="r">Interest paid</th><th class="r">Debt/GDP</th><th class="r">Interest/revenue</th></tr></thead><tbody>' +
      rows.map((r) => '<tr class="' + (r.you ? 'you' : '') + '"><td>' + esc(r.name) + '</td>' +
        '<td class="' + (r.s.won ? 'tone-good' : 'tone-bad') + '">' + outcomeText(r.s) + '</td>' +
        '<td class="r num">' + fmtT(r.s.interestPaid) + '</td>' +
        '<td class="r num">' + pct(r.s.debt / r.s.gdp * 100, 0) + '</td>' +
        '<td class="r num' + (best !== null && r.s.won && r.s.intRev === best ? ' tone-good' : '') + '">' + pct(r.s.intRev) + '</td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div><span class="label">What you lived through</span><ul class="recap" style="margin-top:8px">' +
      seen.map((id) => { const e = R.BY_ID[id]; return '<li><b>' + esc(e.title) + '</b>' + esc(e.lesson) + '</li>'; }).join('') +
      '</ul></div>' +
      '<div><span class="label">The big ideas</span><ul class="rules" style="margin-top:8px">' +
      '<li>The Fed controls short rates. Markets set long rates: expected Fed policy plus a term premium.</li>' +
      '<li>Bills are cheap until the Fed hikes. Then the whole stack reprices at once (rollover risk).</li>' +
      '<li>Bonds lock in a rate, but flooding the market with them raises the term premium for everyone.</li>' +
      '<li>When interest rates exceed growth, debt grows on its own. Interest is itself borrowed.</li>' +
      '</ul></div>' +
      '<div class="seedrow"><button class="primary" id="replayBtn" type="button">Replay world #' + world.seed + '</button>' +
      '<button class="chipbtn" id="newBtn" type="button">New world</button></div>';
    show('#end');
    $('#replayBtn').addEventListener('click', () => { startGame(world.seed); nextTurn(); });
    $('#newBtn').addEventListener('click', () => { startGame(R.randomSeed()); nextTurn(); });
    $('#replayBtn').focus({ preventScroll: true });
  }

  // ---- shell -------------------------------------------------------------
  function show(sel) { $(sel).hidden = false; }
  function hide(sel) { $(sel).hidden = true; }

  function showIntro() {
    phase = 'intro';
    $('#seedInput').value = world.seed;
    show('#intro');
    $('#startBtn').focus({ preventScroll: true });
  }

  function boot(data) {
    $('#helpBtn').addEventListener('click', () => { show('#intro'); $('#startBtn').textContent = world ? 'Back to the desk' : 'Take office'; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#news').hidden) closeNews(); });
    $('#startBtn').addEventListener('click', () => {
      const want = parseInt($('#seedInput').value, 10);
      if (world && phase !== 'intro' && (!want || want === world.seed)) {
        hide('#intro');
        return;
      }
      startGame(want > 0 ? want : R.randomSeed());
      nextTurn();
    });
    // Preview a realistic desk behind the intro sheet.
    if (data && data.seed && data.phase && data.phase !== 'intro') {
      startGame(data.seed, data.phase === 'decide' ? data.decisions : data.decisions.slice(0, -1));
      if (data.phase === 'decide') { share = data.share != null ? data.share : share; nextTurn(); }
      else {
        brief = R.beginTurn(st, world);
        lastEntry = R.resolveTurn(st, data.decisions[data.decisions.length - 1]);
        decisions.push(data.decisions[data.decisions.length - 1]);
        phase = st.over && data.phase === 'end' ? 'end' : 'result';
        render();
        if (phase === 'end') showEnd();
      }
      return;
    }
    const qs = new URLSearchParams(location.search).get('seed');
    startGame(qs && /^\d+$/.test(qs) ? +qs : R.randomSeed());
    brief = R.beginTurn(st, world);
    phase = 'decide';
    render();
    phase = 'intro';
    showIntro();
  }

  if (window.claude && window.claude.hot) {
    window.claude.hot.snapshot(() => ({ seed: world && world.seed, decisions, phase, share }));
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(boot);
  else boot(hot && hot.data ? hot.data : {});
})();
