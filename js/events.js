// Event deck for Rollover. Each event nudges the economy, the budget, or the
// appetite of bond buyers. Magnitudes are scaled 0.75–1.25x per run.
//
// fx fields (all optional):
//   spend      permanent change to federal spending, % of GDP
//   spendTemp  one-turn spending change, % of GDP
//   revenue    permanent change to federal revenue, % of GDP
//   gap        shock to the output gap (economy running hot/cold), pts
//   inf        shock to inflation, pts
//   tp         shock to the 10-year term premium, pts (fades by half each turn)
//   fedShift   Fed surprise added to its rule-based rate, pts
//   buyers     { buyer: { s, l } } fractional change in short / long appetite
//   decay      how much of the buyer change survives each turn (default 0.5)
(function (root) {
  const EVENTS = [
    // ---- Congress -------------------------------------------------------
    {
      id: 'tax_cut', cat: 'Congress', weight: 1.2,
      title: 'Congress passes a major tax cut',
      text: 'Lower rates for households and businesses. Revenue falls by about 1% of GDP every year from now on.',
      lesson: 'Tax cuts are permanent unless Congress reverses them. A permanently bigger deficit means more debt to sell every turn, not just this one.',
      fx: { revenue: -1.0, gap: 0.6 },
    },
    {
      id: 'stimulus', cat: 'Congress', weight: 0.6, tags: ['followsDownturn'],
      title: 'Emergency stimulus package',
      text: 'Checks, extended unemployment benefits, and aid to states. A one-time spending surge.',
      lesson: 'Stimulus supports the economy now and you fund it with debt. Markets handle one-time spending far better than permanent spending.',
      fx: { spendTemp: 2.6, gap: 1.2, inf: 0.3 },
    },
    {
      id: 'infrastructure', cat: 'Congress', weight: 0.9,
      title: 'Infrastructure bill signed',
      text: 'Roads, grid, and broadband. Spending rises by about 0.5% of GDP per year.',
      lesson: 'Spending that lasts years adds to your borrowing needs every turn. Debt compounds quietly.',
      fx: { spend: 0.5, gap: 0.3 },
    },
    {
      id: 'defense', cat: 'Congress', weight: 0.8,
      title: 'Defense buildup',
      text: 'Rising global tensions push Congress to grow the defense budget by about 0.7% of GDP.',
      lesson: 'Military buildups have historically been financed with debt. They also add to demand, which can nudge inflation up.',
      fx: { spend: 0.7, gap: 0.3, inf: 0.3 },
    },
    {
      id: 'austerity', cat: 'Congress', weight: 0.9,
      title: 'Bipartisan deficit-reduction deal',
      text: 'Spending caps and a small tax increase. Deficit falls by about 1.3% of GDP per year.',
      lesson: 'Smaller deficits mean less supply, which eases the term premium. The cost is a slower economy in the short run.',
      fx: { spend: -1.0, revenue: 0.3, gap: -0.8 },
    },
    {
      id: 'debt_ceiling', cat: 'Congress', weight: 0.9,
      title: 'Debt-ceiling standoff',
      text: 'Congress fights over raising the borrowing limit. Default chatter spooks investors.',
      lesson: 'During a standoff, money-market funds avoid bills that mature near the "X-date" when Treasury might run out of cash. Even the threat of default raises borrowing costs.',
      fx: { tp: 0.3, buyers: { mmf: { s: -0.25 } } },
    },
    {
      id: 'aging', cat: 'Congress', weight: 1.0,
      title: 'Entitlement costs climb',
      text: 'More retirees draw Social Security and Medicare. Spending creeps up about 0.4% of GDP.',
      lesson: 'Much of U.S. spending is on autopilot. Demographics raise deficits even when Congress passes nothing new.',
      fx: { spend: 0.4 },
    },
    {
      id: 'tariffs', cat: 'Congress', weight: 0.8,
      title: 'Sweeping new tariffs',
      text: 'Import taxes raise revenue but also raise prices. Trading partners grumble.',
      lesson: 'Tariffs raise some revenue, but they push up prices, and countries that sell less to the U.S. end up with fewer dollars to recycle into Treasuries.',
      fx: { revenue: 0.4, inf: 0.6, gap: -0.3, buyers: { foreign: { l: -0.15 } } },
    },

    // ---- Economy --------------------------------------------------------
    {
      id: 'recession', cat: 'Economy', weight: 1.0, max: 2, tags: ['downturn'],
      title: 'Recession hits',
      text: 'Layoffs spread and tax receipts drop. Unemployment insurance and other safety-net spending jump automatically.',
      lesson: 'Recessions widen the deficit automatically: revenue falls and safety-net spending rises. The Fed cuts, so short-term borrowing gets cheap.',
      fx: { gap: -3.2, inf: -0.6 },
    },
    {
      id: 'boom', cat: 'Economy', weight: 0.9,
      title: 'Economy booms',
      text: 'Hiring is strong and tax receipts surge. Some worry the economy is overheating.',
      lesson: 'Booms shrink deficits, but a hot economy pushes inflation up and the Fed responds by hiking.',
      fx: { gap: 1.6, inf: 0.3 },
    },
    {
      id: 'inflation_spike', cat: 'Economy', weight: 0.9, max: 2, tags: ['inflation'],
      title: 'Inflation surges',
      text: 'Supply chains snarl and prices jump across the board.',
      lesson: 'Inflation forces the Fed to hike. Every dollar of short-term debt reprices at the higher rate almost immediately.',
      fx: { inf: 2.6 },
    },
    {
      id: 'productivity', cat: 'Economy', weight: 0.7,
      title: 'AI productivity boom',
      text: 'Output per worker rises fast. Growth picks up while prices stay calm.',
      lesson: 'Faster growth is the gentlest way out of debt: GDP grows faster than the debt, so debt/GDP falls.',
      fx: { gap: 0.4, inf: -0.5, revenue: 0.4 },
    },
    {
      id: 'housing_slump', cat: 'Economy', weight: 0.7, tags: ['downturnLite'],
      title: 'Housing market slumps',
      text: 'High mortgage rates freeze home sales. Construction slows and banks tighten lending.',
      lesson: 'Long-term Treasury yields set the base for mortgage rates. When the 10-year climbs, housing usually cracks first.',
      fx: { gap: -1.4, inf: -0.2, buyers: { banks: { l: -0.2 } } },
    },

    // ---- World ----------------------------------------------------------
    {
      id: 'oil_shock', cat: 'World', weight: 0.8, tags: ['inflation'],
      title: 'Oil price shock',
      text: 'Conflict in a major producing region sends crude prices soaring.',
      lesson: 'Supply shocks are the worst case for the Fed: inflation rises while the economy weakens.',
      fx: { inf: 1.8, gap: -1.0 },
    },
    {
      id: 'flight_to_safety', cat: 'World', weight: 0.8, tags: ['downturn'],
      title: 'Global crisis: flight to safety',
      text: 'Markets panic overseas. Investors worldwide rush into U.S. Treasuries.',
      lesson: 'Treasuries are the world\'s safe asset. In a panic, demand surges and yields fall, which is a good moment to lock in long-term borrowing.',
      fx: { gap: -1.2, tp: -0.5, buyers: { foreign: { s: 0.3, l: 0.45 }, pensions: { l: 0.1 } } },
    },
    {
      id: 'reserve_diversify', cat: 'World', weight: 0.8,
      title: 'Central banks diversify away from Treasuries',
      text: 'Several large foreign central banks shift reserves into gold and other currencies.',
      lesson: 'Foreign official buyers once absorbed a large share of new Treasuries. When they step back, someone else has to buy, usually at a higher yield.',
      fx: { buyers: { foreign: { l: -0.35, s: -0.1 } }, decay: 0.8 },
    },
    {
      id: 'dollar_surge', cat: 'World', weight: 0.6,
      title: 'Dollar surges',
      text: 'A soaring dollar forces foreign central banks to sell Treasuries to defend their currencies.',
      lesson: 'Foreign central banks hold Treasuries as a war chest. When they need dollars, they sell them.',
      fx: { buyers: { foreign: { s: -0.2, l: -0.25 } } },
    },
    {
      id: 'japan_hikes', cat: 'World', weight: 0.6,
      title: 'Japan raises interest rates',
      text: 'Higher yields at home lure Japanese pension funds and insurers back from U.S. bonds.',
      lesson: 'Japan is the largest foreign holder of Treasuries. Global rates are connected: higher yields abroad pull money away from U.S. debt.',
      fx: { tp: 0.2, buyers: { foreign: { l: -0.3 } } },
    },

    // ---- Markets & the Fed ---------------------------------------------
    {
      id: 'basis_unwind', cat: 'Markets', weight: 0.7,
      title: 'Hedge-fund basis trade unwinds',
      text: 'Leveraged funds that bought Treasuries with borrowed money are forced to sell all at once.',
      lesson: 'Leveraged buyers are fair-weather friends. When their funding dries up, they dump bonds and yields spike even though nothing fundamental changed.',
      fx: { tp: 0.7, buyers: { banks: { l: -0.1 } } },
    },
    {
      id: 'bank_stress', cat: 'Markets', weight: 0.7, tags: ['downturn'],
      title: 'Regional bank failures',
      text: 'Banks sitting on old, low-yield bonds face big losses. Depositors flee to money funds.',
      lesson: 'When yields rise, old bonds lose value. Banks holding them take losses (Silicon Valley Bank, 2023) and stop buying, while cash floods into bills.',
      fx: { gap: -0.8, fedShift: -0.5, buyers: { banks: { l: -0.5 }, mmf: { s: 0.25 } } },
    },
    {
      id: 'pension_rebalance', cat: 'Markets', weight: 0.6,
      title: 'Pensions lock in yields',
      text: 'Pension funds and insurers shift from stocks into long-term bonds to match their future payouts.',
      lesson: 'Pensions owe money decades from now, so they love long bonds, especially when yields are high.',
      fx: { buyers: { pensions: { l: 0.35 } } },
    },
    {
      id: 'fed_hawk', cat: 'Markets', weight: 0.5,
      title: 'New Fed chair talks tough',
      text: 'The incoming chair vows to crush inflation "whatever it takes."',
      lesson: 'The Fed sets short rates directly. A more aggressive Fed raises your bill costs right away, but it can calm long rates by anchoring inflation.',
      fx: { fedShift: 0.75, tp: -0.15 },
    },
    {
      id: 'fed_pressure', cat: 'Markets', weight: 0.6,
      title: 'White House pressures the Fed to cut',
      text: 'Political pressure pushes the Fed to cut rates faster than the data justify.',
      lesson: 'Cutting short rates under political pressure can backfire. Investors fear inflation and demand a higher term premium, so long rates can rise even as the Fed cuts.',
      fx: { fedShift: -0.75, inf: 0.4, tp: 0.45 },
    },
  ];

  const api = { EVENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RolloverEvents = api;
})(typeof self !== 'undefined' ? self : this);
