# Rollover

A five-minute learning game about the U.S. bond market. You run Treasury
borrowing: Congress tells you how much it needs, and you choose how much to
borrow in short-term bills and how much in long-term bonds. The Fed sets
short rates by rule, buyers react to world events, and you watch how the
10-year yield and the interest bill respond.

See [DESIGN.md](DESIGN.md) for the game design and model.

## Play

It's a static page with no build step.

- **Locally:** serve the folder (for example `npx http-server .`) and open
  `http://localhost:8080`. Add `?seed=1234` to pick a specific world.
- **GitHub Pages:** in the repo, go to **Settings → Pages**, set **Source** to
  *Deploy from a branch*, and choose the branch and `/ (root)`. The game is
  then at `https://<user>.github.io/<repo>/`.

## Code

- `js/events.js`: the event deck
- `js/sim.js`: simulation engine (pure functions, shared by the page and the tests)
- `js/game.js`: the UI
- `test/`: engine tests, run with `npm test` (Node 18+)
