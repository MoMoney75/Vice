# Vise — NFL Market Desk

Vise is a small NFL research dashboard for comparing live US sportsbook prices and
reviewing current-season team and player results. It is an informational tool,
not a betting recommendation service. The dashboard includes spreads, moneylines,
totals, anytime touchdown markets, and player passing/rushing/receiving props.

## Run locally

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. To enable sportsbook prices, create an API key with a plan that covers your
   expected usage and put it in `.env`. Without a key, the schedule and available
   team trends still load.
4. Run `npm run dev` and open the local Vite URL printed in the terminal.

The API server uses ESPN's public NFL scoreboard, player statistics, injury
report, event summaries, and NFL news feed. Closing spread lines from ESPN
event summaries are used to calculate current-season home/away against-the-
spread (ATS) records; games without a verified closing line are excluded.
Browse the recent ESPN coverage in the NFL News view. It uses
[The Odds API](https://the-odds-api.com/) for US bookmaker prices. Game lines
compare Hard Rock Bet, DraftKings, FanDuel, and Caesars when available; player
props include every US bookmaker returned for the requested market. Game lines
refresh every 15 minutes; player props refresh every six hours. The board checks
for updated data every 60 seconds, while the
odds caches prevent each check from spending additional credits. Schedule and
results refresh every 60 seconds, and the player-stat, injury, roster, and news
feeds have their own cache intervals. Odds responses and quota state are
persisted in the ignored local `.vice-cache.json`; the larger, non-costly ESPN
responses stay in memory. Keep API keys in `.env`; do not commit them. Check
your provider's current plan quota before enabling frequent full-slate refreshes.

The board keeps every game from the current ESPN NFL week visible, including
completed games and final scores, until ESPN advances to the next week. Live
odds, player props, and parlay building remain limited to not-yet-started games.
The smart-bet screen compares the best available book
price with the average no-vig probability from paired sportsbook markets. Its
expected-return figure is market-derived, not an independent prediction.
Parlay options include a higher-hit-rate set and a higher-payout set that
requires spread/total legs. Parlay hit-rate estimates multiply consensus
probabilities for different games, and use leg prices from one sportsbook;
they assume independence and are not guarantees.

Pick of the Week is selected once per NFL week from spread and total lines
priced by at least two sportsbooks. The highest no-vig market chance ranks
first; ties favor broader book coverage, then a stable game and market order.
The selected matchup and side/line are persisted locally and stay fixed until
the ESPN week changes, including across API restarts and Odds API key changes.
The displayed price updates only when the same selection remains confirmed by
at least two books; otherwise Vise keeps the last confirmed price and labels
it as such. ESPN season scoring form, recent scorelines, related headlines, and
the injury report are refreshed as context; they do not change the selection
or its market-derived probability. This stability strategy prevents the
featured pick from flipping during the week, but it cannot ensure that a pick
wins or validate it as a prediction. Game-pick research notes describe each
team's current-season scoring and points allowed, recent results, and related
injury/news information. Pick explanations present market context, team form,
home/away ATS results, injury notes, and news as separate scan-friendly points.

Vise tracks each locked weekly Pick of the Week against the final ESPN score.
Spread picks are graded against the saved selection-side point; totals are
graded against the saved over/under line. Wins, losses, pushes, pending picks,
and week-by-week results are persisted in the local ignored cache file. The
record does not change or retroactively reselect earlier picks. Smart game
picks are also captured per game and week, retain their original selection,
and are graded against final scores. The History view shows both pick types
for the season, with final scores and available passing, rushing, and receiving
leaders from ESPN box scores.

Player-prop research supports anytime touchdowns, passing yards, rushing yards,
receptions, and receiving yards. It compares player markets across at least two
books and includes available ESPN leaderboard totals/ranks, team scoring form,
opponent points allowed, recent team scorelines, injury status, and related
ESPN headlines. Each prop also shows the opposing defense's current-season
allowed totals and per-game averages for the matching stat (such as rushing
yards and rushing touchdowns), plus its league rank by per-game allowance.
These opponent totals are aggregated from ESPN completed-game box scores and
are descriptive context, not a player projection. Cached ESPN team rosters
help identify players missing from the leaderboard and provide their position.
ESPN player leaderboard values are cumulative season totals, not per-game or
matchup projections.
Anytime-touchdown prices are often posted as Yes-only markets, so their
displayed implied chances are not de-vigged. The odds market is not an
independent performance model, and player availability and reported news can
change before kickoff.

Player props are grouped by game kickoff; all game groups start collapsed and
players within a game follow ESPN's offensive depth chart for the selected
market, with unavailable depth-chart entries following by market-implied
chance. Each listed player shows their depth-chart slot when available. Props
available at only one book are still shown, but labeled as single-book
references rather than multi-book consensus. The Anytime TD
Parlays view suggests two- and three-game combinations at one sportsbook.
Candidates with known out, doubtful, injured-reserve, or PUP status are
excluded. Ideas are ranked using the player's offense scoring rate and the
opponent's points allowed per game alongside median live anytime-TD prices.
Displayed parlay chances multiply raw implied probabilities, include
bookmaker margin, and assume different games are independent. The team-trend
rank is descriptive context, not a validated scoring or success probability.

Each player-prop event request asks for five markets and costs five market
credits for the US region. Vise preloads props for upcoming games with odds and
caches each event for six hours; a 14-game slate may therefore use up to 70
credits each time those event caches expire. Fetching spread, moneyline, and
total prices costs another three credits each time the game-odds cache refreshes.
At the configured 15-minute game-odds and six-hour player-prop intervals, a
14-game slate could use up to 568 credits in 24 hours (288 for game odds and
280 for props). Actual usage depends on events, available markets, cache state,
and provider billing. The interface displays estimated player-prop usage.
Single-book props are shown as references, not consensus; when multiple books
offer the same player and line, Vise compares them. Vise checks the available
balance before cost-bearing requests and
pauses sportsbook requests when there are not enough credits.

## Production build

Run `npm run build`, then start the API and static frontend together with
`NODE_ENV=production npm start`.

## Deploy on Render

The repository includes a Render Blueprint in `render.yaml`. It builds the
frontend, starts the Express server, sets `NODE_ENV=production`, and checks
`/api/health`. When deploying from this Blueprint, enter `ODDS_API_KEY` in
Render when prompted; do not commit the key.

For an existing Render Web Service not managed by the Blueprint, set **Build
Command** to `npm ci --include=dev && npm run build`, **Start Command** to
`npm start`, and add `NODE_ENV=production` and `ODDS_API_KEY` under the
service's environment variables. The explicit `--include=dev` ensures build
tools such as Vite are installed even when `NODE_ENV=production`. The app is
served at the service root, the board endpoint is `/api/nfl/board`, and
`/api/health` returns `{ "status": "ok" }` when the server is reachable.
Adding the Odds API key enables sportsbook odds; it does not determine whether
the web service itself starts.

Run the market-analysis tests with `npm test`.
