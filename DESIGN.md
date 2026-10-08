# Rollover: design

A five-minute learning game about how the U.S. Treasury, the Federal Reserve,
and the bond market interact. You play the Treasury's debt managers. Congress
decides how much to spend; you decide how to borrow it.

## Learning goals

After two or three runs, a player should be able to explain:

1. **The Fed controls short rates; the market sets long rates.** The 10-year
   yield is roughly *where markets expect the Fed's rate to be over ten years*
   plus a **term premium** for the risk of lending long.
2. **Rollover risk.** Short-term debt is usually cheaper, but it has to be
   re-borrowed constantly, so a Fed hiking cycle reprices it almost at once.
3. **Supply matters.** Selling more long bonds than buyers want pushes the
   term premium (and every long rate) up. Auctions can tail or fail.
4. **Buyers have reasons.** Money funds, banks, foreign central banks,
   pensions, and the Fed each buy for different reasons and react differently
   to events.
5. **Interest compounds.** Interest is itself borrowed. When rates exceed
   growth, debt/GDP rises even with no new spending.

## Core loop

One turn is one Congress (two years). Ten turns run from 2027 to 2047.

1. **Briefing.** One or two event cards (Congress, economy, world, markets),
   each with a one-line "why it matters." The economy updates and the Fed
   sets its rate by rule; the player sees the result and the Fed's reason.
2. **The bill.** "Congress needs you to raise $X": this term's deficit
   spending, interest due, maturing bills, and maturing bonds.
3. **One decision.** A slider splits the borrowing between:
   - **Bills (short):** stand-ins for Treasury bills (4 weeks to 1 year).
     They pay about the Fed's rate and all come due next turn.
   - **Bonds (long):** stand-ins for notes and bonds (2 to 30 years),
     modeled as 10-year notes that lock in their rate for five turns.

   Live gauges compare what you're selling against roughly how much buyers
   want, with a forecast ("strong demand", "likely to tail", "auction will
   fail"). An optional 30-second clock keeps the pace up.
4. **Auction results.** Clearing yields for bills and bonds, tails or
   failures, and a short debrief that splits the 10-year's move into its
   expected-Fed-path part and its term-premium part, naming the biggest
   driver.
5. **Next Congress.**

The end screen replays the **same world** with three fixed strategies (all
bills, balanced, mostly long) so the player can see what their choices
actually changed, then recaps every event's lesson.

**Lose conditions:** interest above 35% of federal revenue (about 18% today),
or two failed auctions.

## Pacing

Target is about five minutes per run: roughly 25 seconds per turn (5s to read,
5–10s to decide, a few seconds of results) plus a summary. Events are much
more frequent than in real life so one run covers a full cycle: boom,
recession, inflation shock, buyer shifts.

## Randomness within realistic bounds

- **Seeded worlds.** The whole history (events, sizes, shocks, starting
  debt and inflation) is drawn up front from a seed. The same seed replays the
  same world under any strategy, which makes comparisons fair.
- **Event deck** (`js/events.js`): 23 events across Congress, Economy, World,
  and Markets. Each has a realistic magnitude, scaled 0.75–1.25x per run.
- **Director rules:** no event repeats back to back; most events appear at
  most once; stimulus usually follows a downturn; inflation shocks are more
  likely after big spending; recessions are likelier after booms; every run
  is guaranteed at least one downturn and one inflation shock.
- **Buyers react to events** (foreign buyers flee or flock in, banks retreat
  after losses, money funds pile into bills) and to market conditions
  (pensions buy more when yields are high; banks buy less after yields jump;
  money funds hold more bills when the Fed rate is high).
- **The Fed** follows its rule with a little noise, plus occasional surprises
  (a hawkish new chair, political pressure to cut).

## Model (`js/sim.js`)

Deliberately simple, tuned for clear cause and effect rather than precision.

| Piece | Rule |
|---|---|
| Output gap | Persists, hit by events, pulled down by high real rates and high 10-year yields, pushed by fiscal impulse |
| Inflation | Reverts toward 2%, rises with the output gap and supply shocks |
| Fed rate | Taylor-style rule: neutral + inflation + 0.5×(inflation gap) + 0.5×(output gap), smoothed, rounded to 25 bp; QE in deep recessions, QT when inflation is high |
| Bill yield | Fed rate + 0.1 + a small spread if bill supply exceeds bill demand |
| 10-year yield | Expected Fed path + term premium |
| Term premium | Base + debt/GDP + inflation uncertainty + supply pressure (bonds sold vs. buyer appetite) + interest-burden worry + event shocks |
| Failed auction | Bonds offered above 2× appetite: a strike plus a lasting term-premium shock |
| Budget | Spending and revenue in % of GDP with automatic stabilizers; interest is computed on the actual stock (bills at today's rate, each bond vintage at its locked-in coupon) |

### Calibration

Across 400 random worlds:

| Strategy | Survives |
|---|---|
| All bills | ~19% |
| Balanced (35% long) | ~69% |
| Mostly long (70%) | ~42% |
| All long | ~13% |
| Reading buyers and timing rates | ~74% |

Re-check these numbers with the tests and a quick sweep after changing any
constants.

## Out of scope for the prototype

Treasury buybacks, a playable Fed, the Treasury General Account, maturities
between bills and 10-year notes, and historical scenario modes (2020 "dash for
cash", 2022 hikes, August 2023 refunding). Buybacks are the natural next
lever: they're funded by new issuance, so they reshape the debt without
shrinking it.
