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
//   (example: a real-world parallel shown to the player)
//   decay      how much of the buyer change survives each turn (default 0.5)
(function (root) {
  const EVENTS = [
    // ---- Congress -------------------------------------------------------
    {
      id: 'tax_cut', cat: 'Congress', weight: 1.2,
      title: 'Congress passes a major tax cut',
      example: '2001–03 Bush tax cuts; 2017 Tax Cuts and Jobs Act',
      text: 'Lower rates for households and businesses. Revenue falls by about 1% of GDP every year from now on.',
      lesson: 'Tax cuts are permanent unless Congress reverses them. A permanently bigger deficit means more debt to sell every turn, not just this one.',
      fx: { revenue: -1.0, gap: 0.6 },
    },
    {
      id: 'stimulus', cat: 'Congress', weight: 0.6, tags: ['followsDownturn'],
      title: 'Emergency stimulus package',
      example: '2009 Recovery Act; 2020–21 COVID relief and the American Rescue Plan',
      text: 'Checks, extended unemployment benefits, and aid to states. A one-time spending surge.',
      lesson: 'Stimulus supports the economy now and you fund it with debt. Markets handle one-time spending far better than permanent spending.',
      fx: { spendTemp: 2.6, gap: 1.2, inf: 0.6 },
    },
    {
      id: 'infrastructure', cat: 'Congress', weight: 0.9,
      title: 'Infrastructure bill signed',
      example: '2021 Infrastructure Investment and Jobs Act',
      text: 'Roads, grid, and broadband. Spending rises by about 0.5% of GDP per year.',
      lesson: 'Spending that lasts years adds to your borrowing needs every turn. Debt compounds quietly.',
      fx: { spend: 0.5, gap: 0.3 },
    },
    {
      id: 'defense', cat: 'Congress', weight: 0.8,
      title: 'Defense buildup',
      example: '1980s Reagan defense buildup; post-2001 war spending',
      text: 'Rising global tensions push Congress to grow the defense budget by about 0.7% of GDP.',
      lesson: 'Military buildups have historically been financed with debt. They also add to demand, which can nudge inflation up.',
      fx: { spend: 0.7, gap: 0.3, inf: 0.3 },
    },
    {
      id: 'austerity', cat: 'Congress', weight: 0.9,
      title: 'Bipartisan deficit-reduction deal',
      example: '1990s budget deals; 2011 Budget Control Act and the 2013 sequester',
      text: 'Spending caps and a small tax increase. Deficit falls by about 1.3% of GDP per year.',
      lesson: 'Smaller deficits mean less supply, which eases the term premium. The cost is a slower economy in the short run.',
      fx: { spend: -1.0, revenue: 0.3, gap: -0.5 },
    },
    {
      id: 'debt_ceiling', cat: 'Congress', weight: 0.9,
      title: 'Debt-ceiling standoff',
      example: '2011 standoff and the S&P downgrade; the 2023 X-date scare',
      text: 'Congress fights over raising the borrowing limit. Default chatter spooks investors.',
      lesson: 'During a standoff, money-market funds avoid bills that mature near the "X-date" when Treasury might run out of cash. Even the threat of default raises borrowing costs.',
      fx: { tp: 0.3, gap: -0.2, buyers: { mmf: { s: -0.25 } } },
    },
    {
      id: 'aging', cat: 'Congress', weight: 1.0,
      title: 'Entitlement costs climb',
      example: 'Baby boomers retiring since 2011',
      text: 'More retirees draw Social Security and Medicare. Spending creeps up about 0.4% of GDP.',
      lesson: 'Much of U.S. spending is on autopilot. Demographics raise deficits even when Congress passes nothing new.',
      fx: { spend: 0.4 },
    },
    {
      id: 'tariffs', cat: 'Congress', weight: 0.8,
      title: 'Sweeping new tariffs',
      example: '2018–19 China tariffs; 2025 tariff increases',
      text: 'Import taxes raise revenue but also raise prices. Trading partners grumble.',
      lesson: 'Tariffs raise some revenue, but they push up prices, and countries that sell less to the U.S. end up with fewer dollars to recycle into Treasuries.',
      fx: { revenue: 0.4, inf: 0.6, gap: -0.3, buyers: { foreign: { l: -0.15 } } },
    },

    // ---- Economy --------------------------------------------------------
    {
      id: 'recession', cat: 'Economy', weight: 1.0, max: 2, tags: ['downturn'],
      title: 'Recession hits',
      example: '2001 dot-com bust; 2008–09 Great Recession',
      text: 'Layoffs spread and tax receipts drop. Unemployment insurance and other safety-net spending jump automatically.',
      lesson: 'Recessions widen the deficit automatically: revenue falls and safety-net spending rises. The Fed cuts, so short-term borrowing gets cheap.',
      fx: { gap: -5.0, inf: -0.7 },
    },
    {
      id: 'boom', cat: 'Economy', weight: 0.9,
      title: 'Economy booms',
      example: 'Late-1990s expansion; 2021 reopening boom',
      text: 'Hiring is strong and tax receipts surge. Some worry the economy is overheating.',
      lesson: 'Booms shrink deficits, but a hot economy pushes inflation up and the Fed responds by hiking.',
      fx: { gap: 1.6, inf: 0.3 },
    },
    {
      id: 'inflation_spike', cat: 'Economy', weight: 0.9, max: 2, tags: ['inflation'],
      title: 'Inflation surges',
      example: '2021–22, when inflation peaked at 9%',
      text: 'Supply chains snarl and prices jump across the board.',
      lesson: 'Inflation forces the Fed to hike. Every dollar of short-term debt reprices at the higher rate almost immediately.',
      fx: { inf: 3.0 },
    },
    {
      id: 'productivity', cat: 'Economy', weight: 0.7,
      title: 'AI productivity boom',
      example: 'Late-1990s tech productivity boom',
      text: 'Output per worker rises fast. Growth picks up while prices stay calm.',
      lesson: 'Faster growth is the gentlest way out of debt: GDP grows faster than the debt, so debt/GDP falls.',
      fx: { gap: 0.4, inf: -0.5, revenue: 0.4 },
    },
    {
      id: 'housing_slump', cat: 'Economy', weight: 0.7, tags: ['downturnLite'],
      title: 'Housing market slumps',
      example: '2006–07 housing bust; 2022–23 mortgage-rate freeze',
      text: 'High mortgage rates freeze home sales. Construction slows and banks tighten lending.',
      lesson: 'Long-term Treasury yields set the base for mortgage rates. When the 10-year climbs, housing usually cracks first.',
      fx: { gap: -1.4, inf: -0.2, buyers: { banks: { l: -0.2 } } },
    },

    // ---- World ----------------------------------------------------------
    {
      id: 'oil_shock', cat: 'World', weight: 0.8, tags: ['inflation'],
      title: 'Oil price shock',
      example: '1973 OPEC embargo; 1979 Iranian revolution; 2022 invasion of Ukraine',
      text: 'Conflict in a major producing region sends crude prices soaring.',
      lesson: 'Supply shocks are the worst case for the Fed: inflation rises while the economy weakens.',
      fx: { inf: 1.8, gap: -1.4 },
    },
    {
      id: 'flight_to_safety', cat: 'World', weight: 0.8, tags: ['downturn'],
      title: 'Global crisis: flight to safety',
      example: '2008 global financial crisis; 2011 euro crisis',
      text: 'Markets panic overseas. Investors worldwide rush into U.S. Treasuries.',
      lesson: 'Treasuries are the world\'s safe asset. In a panic, demand surges and yields fall, which is a good moment to lock in long-term borrowing.',
      fx: { gap: -1.2, tp: -0.5, buyers: { foreign: { s: 0.3, l: 0.45 }, pensions: { l: 0.1 } } },
    },
    {
      id: 'reserve_diversify', cat: 'World', weight: 0.8,
      title: 'Central banks diversify away from Treasuries',
      example: 'China trimming its Treasuries since 2013; central-bank gold buying since 2022',
      text: 'Several large foreign central banks shift reserves into gold and other currencies.',
      lesson: 'Foreign official buyers once absorbed a large share of new Treasuries. When they step back, someone else has to buy, usually at a higher yield.',
      fx: { buyers: { foreign: { l: -0.35, s: -0.1 } }, decay: 0.8 },
    },
    {
      id: 'dollar_surge', cat: 'World', weight: 0.6,
      title: 'Dollar surges',
      example: '2015–16 and 2022, when foreign central banks sold Treasuries to defend their currencies',
      text: 'A soaring dollar forces foreign central banks to sell Treasuries to defend their currencies.',
      lesson: 'Foreign central banks hold Treasuries as a war chest. When they need dollars, they sell them.',
      fx: { buyers: { foreign: { s: -0.2, l: -0.25 } } },
    },
    {
      id: 'japan_hikes', cat: 'World', weight: 0.6,
      title: 'Japan raises interest rates',
      example: '2024 Bank of Japan hikes and the yen carry-trade unwind',
      text: 'Higher yields at home lure Japanese pension funds and insurers back from U.S. bonds.',
      lesson: 'Japan is the largest foreign holder of Treasuries. Global rates are connected: higher yields abroad pull money away from U.S. debt.',
      fx: { tp: 0.2, buyers: { foreign: { l: -0.3 } } },
    },

    // ---- Markets & the Fed ---------------------------------------------
    {
      id: 'basis_unwind', cat: 'Markets', weight: 0.7,
      title: 'Hedge-fund basis trade unwinds',
      example: 'March 2020 "dash for cash"',
      text: 'Leveraged funds that bought Treasuries with borrowed money are forced to sell all at once.',
      lesson: 'Leveraged buyers are fair-weather friends. When their funding dries up, they dump bonds and yields spike even though nothing fundamental changed.',
      fx: { tp: 0.7, buyers: { banks: { l: -0.1 } } },
    },
    {
      id: 'bank_stress', cat: 'Markets', weight: 0.7, tags: ['downturn'],
      title: 'Regional bank failures',
      example: 'March 2023: Silicon Valley Bank and Signature Bank',
      text: 'Banks sitting on old, low-yield bonds face big losses. Depositors flee to money funds.',
      lesson: 'When yields rise, old bonds lose value. Banks holding them take losses (Silicon Valley Bank, 2023) and stop buying, while cash floods into bills.',
      fx: { gap: -0.8, fedShift: -0.5, buyers: { banks: { l: -0.5 }, mmf: { s: 0.25 } } },
    },
    {
      id: 'pension_rebalance', cat: 'Markets', weight: 0.6,
      title: 'Pensions lock in yields',
      example: '2023–24, when pensions locked in 5% yields',
      text: 'Pension funds and insurers shift from stocks into long-term bonds to match their future payouts.',
      lesson: 'Pensions owe money decades from now, so they love long bonds, especially when yields are high.',
      fx: { buyers: { pensions: { l: 0.35 } } },
    },
    {
      id: 'fed_hawk', cat: 'Markets', weight: 0.5,
      title: 'New Fed chair talks tough',
      example: 'Paul Volcker, 1979–82',
      text: 'The incoming chair vows to crush inflation "whatever it takes" and hikes hard.',
      lesson: 'The Fed sets short rates directly. A more aggressive Fed raises your bill costs right away, but it can calm long rates by anchoring inflation.',
      fx: { fedShift: 1.5, gap: -0.5, tp: -0.15 },
    },
    {
      id: 'fed_pressure', cat: 'Markets', weight: 0.6,
      title: 'White House pressures the Fed to cut',
      example: 'Nixon leaning on Fed chair Arthur Burns, early 1970s',
      text: 'Political pressure pushes the Fed to cut rates faster than the data justify.',
      lesson: 'Cutting short rates under political pressure can backfire. Investors fear inflation and demand a higher term premium, so long rates can rise even as the Fed cuts.',
      fx: { fedShift: -0.75, gap: 0.4, inf: 0.5, tp: 0.45 },
    },
  ];

  const api = { EVENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RolloverEvents = api;
})(typeof self !== 'undefined' ? self : this);
