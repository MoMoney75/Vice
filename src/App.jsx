import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  Newspaper,
  Radio,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trophy,
} from "lucide-react";

const MARKETS = [
  { key: "spreads", label: "Spread" },
  { key: "h2h", label: "Moneyline" },
  { key: "totals", label: "Total" },
];

const PLAYER_PROP_MARKETS = [
  { key: "player_anytime_td", label: "Anytime TD" },
  { key: "player_pass_yds", label: "Passing yards" },
  { key: "player_rush_yds", label: "Rushing yards" },
  { key: "player_receptions", label: "Receptions" },
  { key: "player_reception_yds", label: "Receiving yards" },
  { key: "td-parlays", label: "TD parlays" },
];

const DESK_VIEWS = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "props", label: "Player props", icon: Sparkles },
  { key: "picks", label: "Game picks", icon: Trophy },
  { key: "games", label: "Game lines", icon: Radio },
  { key: "teams", label: "Team form", icon: Shield },
  { key: "news", label: "NFL News", icon: Newspaper },
];

const TEAM_GROUPS = [
  {
    division: "AFC EAST",
    teams: ["Buffalo Bills", "Miami Dolphins", "New England Patriots", "New York Jets"],
  },
  {
    division: "AFC NORTH",
    teams: ["Baltimore Ravens", "Cincinnati Bengals", "Cleveland Browns", "Pittsburgh Steelers"],
  },
  {
    division: "AFC SOUTH",
    teams: ["Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Tennessee Titans"],
  },
  {
    division: "AFC WEST",
    teams: ["Denver Broncos", "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers"],
  },
  {
    division: "NFC EAST",
    teams: ["Dallas Cowboys", "New York Giants", "Philadelphia Eagles", "Washington Commanders"],
  },
  {
    division: "NFC NORTH",
    teams: ["Chicago Bears", "Detroit Lions", "Green Bay Packers", "Minnesota Vikings"],
  },
  {
    division: "NFC SOUTH",
    teams: ["Atlanta Falcons", "Carolina Panthers", "New Orleans Saints", "Tampa Bay Buccaneers"],
  },
  {
    division: "NFC WEST",
    teams: ["Arizona Cardinals", "Los Angeles Rams", "San Francisco 49ers", "Seattle Seahawks"],
  },
];

const ALL_TEAMS = TEAM_GROUPS.flatMap((group) => group.teams);

function americanOdds(value) {
  if (typeof value !== "number") return "—";
  return value > 0 ? `+${value}` : `${value}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function bestOffers(event, marketKey) {
  const offers = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((item) => item.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes ?? []) {
      offers.push({
        bookmaker: bookmaker.title,
        name: outcome.name,
        price: outcome.price,
        point: outcome.point,
      });
    }
  }
  const byOutcomeAndLine = new Map();
  for (const offer of offers) {
    const key = `${offer.name}:${offer.point ?? ""}`;
    const existing = byOutcomeAndLine.get(key);
    if (!existing || offer.price > existing.price) byOutcomeAndLine.set(key, offer);
  }
  return [...byOutcomeAndLine.values()];
}

function matchOdds(game, oddsEvents) {
  const canonical = (name) =>
    name?.toLowerCase().replace(/[^a-z]/g, "").replace(/(footballclub|fc)$/, "");
  return oddsEvents.find(
    (event) =>
      canonical(event.home_team) === canonical(game.home?.name) &&
      canonical(event.away_team) === canonical(game.away?.name),
  );
}

function matchSmartBet(game, smartBets) {
  const canonical = (name) => name?.toLowerCase().replace(/[^a-z]/g, "");
  return smartBets.find(
    (item) =>
      canonical(item.homeTeam) === canonical(game.home?.name) &&
      canonical(item.awayTeam) === canonical(game.away?.name),
  );
}

function percentage(value, digits = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function atsRecordText(record) {
  if (!record) return "Closing-line ATS data unavailable";
  const pushes = record.pushes ? `-${record.pushes}` : "";
  return `${record.wins}-${record.losses}${pushes} ATS · ${record.wins + record.losses + record.pushes} games`;
}

function SmartBetEvidence({ evidence }) {
  return (
    <div className="smart-evidence">
      <strong>RESEARCH SNAPSHOT</strong>
      <ul className="pick-evidence-list">
        <li><b>Market:</b> {evidence.market}</li>
        {evidence.teams.map((team) => (
          <li key={team.team}>
            <b>{team.team}:</b> {team.form}; {Number.isFinite(team.offensePointsPerGame)
              ? `${team.offensePointsPerGame.toFixed(1)} scored and ${team.defensePointsAllowedPerGame.toFixed(1)} allowed per game`
              : "season scoring and defense data unavailable"}.
            {" "}{team.venue === "home" ? "Home" : "Away"} {atsRecordText(team.ats)}.
            {team.injuries.length ? ` Injury report: ${team.injuries.join(", ")}.` : ""}
            {team.recentGames.length ? ` Recent: ${team.recentGames.slice(0, 2).join("; ")}.` : ""}
          </li>
        ))}
      </ul>
      <ResearchNews items={evidence.news} />
      <small>ESPN results/news and closing spreads; descriptive context, not a prediction.</small>
    </div>
  );
}

function SmartBetCard({ game, smartBet }) {
  const candidate = smartBet?.candidate;
  return (
    <article className="smart-card">
      <div className="smart-card-head">
        <span className="smart-matchup">{game.away?.abbreviation} @ {game.home?.abbreviation}</span>
        <span className="smart-date">{formatDate(game.date)}</span>
      </div>
      {candidate ? (
        <>
          <div className="smart-pick">
            <div>
              <span className="smart-market">{candidate.market}</span>
              <strong>{candidate.selection}</strong>
            </div>
            <span className="smart-price">{americanOdds(candidate.bestPrice)}</span>
          </div>
          <div className="smart-book">Best listed at {candidate.bestBookmaker} · {candidate.bookCount} books compared</div>
          {smartBet.evidence && (
            <SmartBetEvidence evidence={smartBet.evidence} />
          )}
          <div className="smart-metrics">
            <div>
              <span>FAIR CHANCE*</span>
              <strong>{percentage(candidate.fairProbability)}</strong>
            </div>
            <div>
              <span>PRICE BREAK-EVEN</span>
              <strong>{percentage(candidate.breakEvenProbability)}</strong>
            </div>
            <div>
              <span>EST. RETURN / $1*</span>
              <strong className={candidate.expectedValue >= 0 ? "metric-positive" : "metric-negative"}>
                {candidate.expectedValue >= 0 ? "+" : ""}{percentage(candidate.expectedValue)}
              </strong>
            </div>
          </div>
          <div className={`smart-verdict${smartBet.positiveConsensusEdge ? " has-edge" : ""}`}>
            {smartBet.positiveConsensusEdge ? "Positive market-consensus signal" : "No positive market-consensus signal"}
          </div>
        </>
      ) : (
        <div className="smart-empty">
          <span>No reliable consensus candidate</span>
          <small>Not enough paired sportsbook prices for this game.</small>
        </div>
      )}
    </article>
  );
}

function ResearchNews({ items = [] }) {
  if (!items.length) return null;
  return (
    <ul className="research-news">
      {items.map((item) => (
        <li key={`${item.publishedAt}-${item.headline}`}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.headline}<ExternalLink size={11} />
            </a>
          ) : (
            <span>{item.headline}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function NflNewsSection({ articles = [], updatedAt }) {
  return (
    <section className="nfl-news-section">
      <div className="section-heading">
        <div>
          <div className="eyebrow section-eyebrow"><span /> LEAGUE-WIDE COVERAGE</div>
          <h2>NFL news <span className="heading-count">{articles.length}</span></h2>
        </div>
        <span className="trend-caption">
          ESPN feed{updatedAt ? ` · updated ${formatDate(updatedAt)}` : ""}
        </span>
      </div>
      <div className="analysis-disclaimer">
        <Newspaper size={14} />
        <span>Browse recent league coverage. Open an article to read the full story at ESPN.</span>
      </div>
      <div className="nfl-news-grid">
        {articles.map((article) => (
          <article className="nfl-news-card" key={`${article.publishedAt}-${article.headline}`}>
            <div className="nfl-news-meta">
              <span>{article.publishedAt ? formatDate(article.publishedAt) : "Recent"}</span>
              {article.teams?.length > 0 && <span>{article.teams.join(" · ")}</span>}
            </div>
            <h3>
              {article.url ? (
                <a href={article.url} target="_blank" rel="noreferrer">
                  {article.headline}<ExternalLink size={13} />
                </a>
              ) : article.headline}
            </h3>
            {article.description && <p>{article.description}</p>}
            {article.url && (
              <a className="nfl-news-read" href={article.url} target="_blank" rel="noreferrer">
                Read at ESPN <ArrowUpRight size={13} />
              </a>
            )}
          </article>
        ))}
        {!articles.length && (
          <div className="empty-state">
            <Newspaper size={22} />
            <strong>NFL news is temporarily unavailable</strong>
            <span>The feed will appear here when ESPN responds.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function PlayerPropCard({ pick }) {
  const { candidate, evidence } = pick;
  return (
    <article className="prop-card">
      <div className="prop-card-top">
        <span>{candidate.market}</span>
        <span>{formatDate(candidate.commenceTime)}</span>
      </div>
      <div className="prop-card-pick">
        <div>
          <strong>{candidate.player}</strong>
          <span>
            {candidate.playerTeam ? `${candidate.playerTeam} · ` : ""}
            {candidate.awayTeam} @ {candidate.homeTeam}
          </span>
        </div>
        <span className="prop-price">{americanOdds(candidate.bestPrice)}</span>
      </div>
      <div className="prop-card-selection">
        {candidate.selection}
        {` · ${percentage(candidate.fairProbability)} ${candidate.probabilitySource === "raw implied probability" ? "implied chance (not de-vigged)" : "no-vig market chance"}`}
      </div>
      <div className="prop-book">
        {candidate.bookmakerCount} books compared · Best price at {candidate.bestBookmaker}
      </div>
      <div className="prop-reasoning">
        <strong>THE RESEARCH</strong>
        <ul className="pick-evidence-list prop-evidence-list">
          <li><b>Market:</b> {evidence.market}</li>
        {evidence.seasonStatsAvailable && (
          <li><b>Season production:</b> {evidence.seasonStats.map((stat) =>
            `${stat.value} ${stat.label.toLowerCase()}${stat.rank ? ` (#${stat.rank} ESPN)` : ""}`,
          ).join("; ")}.</li>
        )}
        {!evidence.seasonStatsAvailable && <li>ESPN does not list current-season leaderboard stats for this player and market.</li>}
        {evidence.offense && (
          <li><b>{evidence.offense.team}:</b> {evidence.offense.record}, {evidence.offense.pointsPerGame.toFixed(1)} points per game.</li>
        )}
        {evidence.opponent && (
          <li><b>Opponent defense ({evidence.opponent.team}):</b> {Number.isFinite(evidence.opponent.pointsAllowedPerGame)
            ? `${evidence.opponent.pointsAllowedPerGame.toFixed(1)} points allowed per game`
            : "season scoring data unavailable"}.</li>
        )}
        {evidence.injury && (
          <li><b>Injury report:</b> {evidence.injury.player} ({evidence.injury.status.toLowerCase()}){evidence.injury.detail ? ` · ${evidence.injury.detail}` : ""}.</li>
        )}
        {!evidence.injury && (
          <li>{evidence.injuryReportAvailable
            ? "No non-active injury listing for this player in the latest ESPN report."
            : "Latest injury report unavailable."}</li>
        )}
        {evidence.offense?.recentGames?.length > 0 && (
          <li><b>Recent team results:</b> {evidence.offense.recentGames.join("; ")}.</li>
        )}
        </ul>
        <ResearchNews items={evidence.news} />
        <small>
          {evidence.seasonStatsNote} News and injury reports can change before kickoff.
        </small>
      </div>
    </article>
  );
}

function AnytimeTdParlayCard({ parlay, index }) {
  return (
    <article className="parlay-card td-parlay-card">
      <div className="parlay-card-head">
        <span>TREND-SUPPORTED IDEA {String(index + 1).padStart(2, "0")}</span>
        <span>{parlay.legCount}-LEG · {parlay.bookmaker}</span>
      </div>
      <div className="parlay-summary">
        <div>
          <span>EST. RAW MARKET CHANCE*</span>
          <strong>{percentage(parlay.estimatedProbability)}</strong>
        </div>
        <div>
          <span>INDICATIVE PARLAY PRICE</span>
          <strong>{americanOdds(parlay.combinedAmericanOdds)}</strong>
        </div>
      </div>
      <div className="parlay-legs">
        {parlay.legs.map((leg) => (
          <div className="parlay-leg td-parlay-leg" key={`${leg.eventId}-${leg.player}`}>
            <span className="leg-game">
              {formatDate(leg.commenceTime)} · {leg.eventName}
            </span>
            <strong>{leg.player} · {leg.playerTeam}</strong>
            <span className="leg-price">{americanOdds(leg.marketPrice)}</span>
            <span className="td-parlay-trend">
              Offense {leg.pointsPerGame.toFixed(1)} PPG · {leg.opponent} allows{" "}
              {leg.opponentPointsAllowedPerGame.toFixed(1)} PPG
            </span>
            {leg.injury && (
              <span className="td-parlay-injury">
                Injury status: {leg.injury.status}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="parlay-note">
        Different games; approximate hit rate multiplies raw anytime-TD market
        prices, including sportsbook margin. Team and opponent trends rank these
        ideas but do not change the displayed chance.
      </div>
    </article>
  );
}

function ParlayCard({ parlay, index }) {
  return (
    <article className="parlay-card">
      <div className="parlay-card-head">
        <span>OPTION {String(index + 1).padStart(2, "0")}</span>
        <span>{parlay.legCount}-LEG · {parlay.bookmaker}</span>
      </div>
      <div className="parlay-summary">
        <div>
          <span>ESTIMATED HIT RATE*</span>
          <strong>{percentage(parlay.estimatedProbability)}</strong>
        </div>
        <div>
          <span>INDICATIVE COMBINED PRICE</span>
          <strong>{americanOdds(parlay.combinedAmericanOdds)}</strong>
        </div>
      </div>
      <div className="parlay-legs">
        {parlay.legs.map((leg) => (
          <div className="parlay-leg" key={`${leg.eventId}-${leg.selection}`}>
            <span className="leg-game">{leg.eventName}</span>
            <span>{leg.selection}</span>
            <span className="leg-price">{americanOdds(leg.price)}</span>
          </div>
        ))}
      </div>
      <div className="parlay-note">
        Fair decimal price* {parlay.estimatedDecimalOdds.toFixed(2)} · calculated from listed legs at {parlay.bookmaker}
      </div>
    </article>
  );
}

function TeamPickContext({ team }) {
  const form = team.form;
  const injuries = team.injury?.players ?? [];
  return (
    <div className="pick-context-team">
      <div className="pick-context-title">
        <strong>{team.team}</strong>
        {form && <span>{form.record}</span>}
      </div>
      {form ? (
        <>
          <div className="pick-team-stats">
            <span>{Number.isFinite(form.pointsForPerGame) ? `${form.pointsForPerGame.toFixed(1)} scored/G` : "Scoring unavailable"}</span>
            <span>{Number.isFinite(form.pointsAgainstPerGame) ? `${form.pointsAgainstPerGame.toFixed(1)} allowed/G` : "Defense unavailable"}</span>
            <span className={form.pointDifferential >= 0 ? "positive" : "negative"}>
              {form.pointDifferential > 0 ? "+" : ""}{form.pointDifferential} DIFF
            </span>
          </div>
          <span className="pick-team-ats">
            {team.venue === "home" ? "HOME" : "AWAY"} ATS · {atsRecordText(team.ats)}
          </span>
          {form.recentGames?.length > 0 && (
            <div className="pick-recent-games">
              <span>LAST GAMES</span>
              {form.recentGames.slice(0, 3).map((game) => (
                <span key={`${game.date}-${game.opponent}`}>
                  {game.result} {game.pointsFor}-{game.pointsAgainst} vs. {game.opponent}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="pick-team-stats"><span>Season results unavailable</span></div>
      )}
      <div className="pick-injuries">
        <span className="pick-context-label">INJURY REPORT</span>
        {injuries.length ? injuries.slice(0, 2).map((injury) => (
          <div
            className="pick-injury"
            key={`${injury.player}-${injury.status}`}
            title={injury.detail ?? undefined}
          >
            <span className="injury-status">{injury.status}</span>
            <span>{injury.player}{injury.position ? ` · ${injury.position}` : ""}</span>
          </div>
        )) : (
          <span className="pick-no-injury">
            {team.injury ? "No non-active listings" : "Report unavailable"}
          </span>
        )}
      </div>
    </div>
  );
}

function PickOfWeekCard({ pickOfWeek }) {
  if (!pickOfWeek) {
    return (
      <div className="pick-week-empty">
        No spread or total with paired sportsbook prices is available for this week yet.
      </div>
    );
  }

  const { game, pick } = pickOfWeek;
  return (
    <article className="pick-week-card">
      <div className="pick-week-header">
        <div>
          <div className="eyebrow section-eyebrow"><span /> PICK OF THE WEEK · WEEK {pickOfWeek.week}</div>
          <div className="pick-week-matchup">{game.awayTeam} @ {game.homeTeam}</div>
          <span className="pick-week-date">{formatDate(game.commenceTime)}</span>
        </div>
        <div className="pick-week-probability">
          <span>MARKET-IMPLIED CHANCE*</span>
          <strong>{percentage(pick.fairProbability)}</strong>
        </div>
      </div>
      <div className="pick-week-lock-note">
        <strong>LOCKED THROUGH WEEK {pickOfWeek.week}</strong>
        <span>
          Selected {pickOfWeek.selectedAt ? formatDate(pickOfWeek.selectedAt) : "this week"}
        </span>
        <span>
          {pickOfWeek.priceUpdated
            ? "Same line confirmed by 2+ books"
            : "Showing last confirmed price; 2+ book pricing is unavailable"}
        </span>
      </div>
      <div className="pick-week-selection">
        <span>{pick.market} · {pick.bestBookmaker} · {pick.bookCount} books compared</span>
        <strong>{pick.selection}</strong>
        <b>{americanOdds(pick.bestPrice)}</b>
      </div>
      <div className="pick-week-context">
        <TeamPickContext team={pickOfWeek.context.away} />
        <TeamPickContext team={pickOfWeek.context.home} />
      </div>
      <div className="pick-week-reasoning">
        <strong>WHY THIS PICK IS FEATURED</strong>
        <ul className="pick-evidence-list">
          <li><b>Market:</b> {pick.market} {pick.selection} · {pick.bookCount} books · {percentage(pick.fairProbability)} no-vig consensus chance.</li>
          {[["Away", pickOfWeek.context.away], ["Home", pickOfWeek.context.home]].map(([venue, team]) => (
            <li key={venue}>
                <b>{team.team}:</b> {team.form?.record ?? "record unavailable"}; {venue.toLowerCase()} {atsRecordText(team.ats)}.
              {team.form && Number.isFinite(team.form.pointsForPerGame)
                ? ` ${team.form.pointsForPerGame.toFixed(1)} scored and ${team.form.pointsAgainstPerGame.toFixed(1)} allowed per game.`
                : ""}
            </li>
          ))}
          <li>Injuries, recent scores, and news are shown as context, not model-weighted predictions.</li>
        </ul>
        <ResearchNews items={pickOfWeek.news} />
      </div>
      <div className="pick-week-footnote">
        <strong>METHOD</strong> Highest no-vig spread/total chance with two or more books; selection stays locked for the week. Injury feed updated{" "}
        {pickOfWeek.injuryReportUpdatedAt
          ? formatDate(pickOfWeek.injuryReportUpdatedAt)
          : "time unavailable"}.
      </div>
    </article>
  );
}

function PickOfWeekRecord({ record }) {
  const history = record?.history ?? [];
  return (
    <section className="pick-record-card" aria-label="Pick of the Week record">
      <div className="pick-record-heading">
        <div>
          <div className="eyebrow section-eyebrow"><span /> TRACK RECORD</div>
          <h3>Pick of the Week results</h3>
        </div>
        <span className="pick-record-pending">{record?.pending ?? 0} pending</span>
      </div>
      <div className="pick-record-stats" aria-label="Wins-losses-pushes">
        <div><strong>{record?.wins ?? 0}</strong><span>WINS</span></div>
        <div><strong>{record?.losses ?? 0}</strong><span>LOSSES</span></div>
        <div><strong>{record?.pushes ?? 0}</strong><span>PUSHES</span></div>
      </div>
      <details className="pick-record-history">
        <summary>Weekly pick history <span>{history.length} {history.length === 1 ? "pick" : "picks"}</span></summary>
        {history.length ? (
          <ul>
            {history.map((pick) => (
              <li key={`${pick.season}-${pick.week}`}>
                <span className="pick-record-week">{pick.season} · WEEK {pick.week}</span>
                <span className="pick-record-selection">{pick.selection}</span>
                <span className={`pick-record-result result-${pick.result}`}>
                  {pick.result === "pending" ? "PENDING" : pick.result.toUpperCase()}
                  {pick.score ? ` · ${pick.score}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Completed weekly picks will appear here after the game is final.</p>
        )}
      </details>
      <p className="pick-record-caveat">Graded against final ESPN scores using the locked spread or total line.</p>
    </section>
  );
}

function TeamRecord({ record }) {
  if (!record) return <span className="team-record pending-record">—</span>;
  return (
    <span className="team-record">
      {record.wins}-{record.losses}
      {record.ties ? `-${record.ties}` : ""}
    </span>
  );
}

function GameCard({ game, oddsEvent, marketKey }) {
  const offers = oddsEvent ? bestOffers(oddsEvent, marketKey) : [];
  const showLines = marketKey !== "h2h";

  return (
    <article className="game-card">
      <div className="game-card-top">
        <div className="game-date">
          <Clock3 size={13} />
          {formatDate(game.date)}
        </div>
        <span className="game-status">
          <span className="status-dot" />
          {game.status}
        </span>
      </div>
      <div className="matchup">
        <div className="match-team">
          <span className="team-initials">{game.away?.abbreviation}</span>
          <span className="team-name">{game.away?.name}</span>
          <TeamRecord record={game.away?.record} />
        </div>
        <div className="versus">AT</div>
        <div className="match-team">
          <span className="team-initials">{game.home?.abbreviation}</span>
          <span className="team-name">{game.home?.name}</span>
          <TeamRecord record={game.home?.record} />
        </div>
      </div>
      <div className="game-ats-context">
        <span>HOME ATS <strong>{atsRecordText(game.home?.record?.homeAts)}</strong></span>
        <span>AWAY ATS <strong>{atsRecordText(game.away?.record?.awayAts)}</strong></span>
      </div>
      <div className="offer-list">
        {offers.length ? (
          offers
            .sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity))
            .slice(0, 4)
            .map((offer) => (
              <div className="offer-row" key={`${offer.name}-${offer.point}-${offer.bookmaker}`}>
                <span className="offer-outcome">
                  {offer.name}
                  {showLines && Number.isFinite(offer.point)
                    ? ` ${offer.point > 0 ? "+" : ""}${offer.point}`
                    : ""}
                </span>
                <span className="offer-book">{offer.bookmaker}</span>
                <span className="offer-price">{americanOdds(offer.price)}</span>
              </div>
            ))
        ) : (
          <div className="empty-offers">
            {oddsEvent ? "This market is not available for this game." : "No live prices available"}
          </div>
        )}
      </div>
      <div className="game-card-footer">
        <span>{offers.length ? "Best listed price by outcome" : "Connect odds to compare prices"}</span>
        <ExternalLink size={12} />
      </div>
    </article>
  );
}

export default function App() {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("overview");
  const [pickTab, setPickTab] = useState("smart");
  const [marketKey, setMarketKey] = useState("spreads");
  const [playerPropMarket, setPlayerPropMarket] = useState("player_anytime_td");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [search, setSearch] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [parlayTier, setParlayTier] = useState("higher-payout");

  const loadBoard = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/nfl/board");
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const data = await response.json();
      setBoard(data);
      if (data.errors?.length) setError(data.errors.join(" "));
    } catch (requestError) {
      setError(requestError.message || "Unable to load the NFL board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoard();
    const timer = window.setInterval(loadBoard, 60_000);
    return () => window.clearInterval(timer);
  }, [loadBoard]);

  const navigateView = (view) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const trendsByName = useMemo(
    () => new Map((board?.trends ?? []).map((team) => [team.name.toLowerCase(), team])),
    [board],
  );
  const filteredTeams = TEAM_GROUPS.map((group) => ({
    ...group,
    teams: group.teams.filter((team) => team.toLowerCase().includes(search.toLowerCase())),
  })).filter((group) => group.teams.length);
  const filteredGames = (board?.games ?? []).filter(
    (game) =>
      !selectedTeam ||
      game.home?.name === selectedTeam ||
      game.away?.name === selectedTeam,
  );
  const oddsEvents = board?.odds ?? [];
  const smartBets = board?.analysis?.smartBets ?? [];
  const parlays = board?.analysis?.parlays ?? [];
  const playerProps = board?.playerProps ?? [];
  const filteredPlayerProps =
    playerPropMarket === "td-parlays"
      ? []
      : playerProps.filter(({ candidate }) =>
          candidate.marketKey === playerPropMarket &&
          (!selectedTeam || candidate.playerTeam === selectedTeam),
        );
  const propsByGame = useMemo(() => {
    const games = new Map();
    for (const pick of filteredPlayerProps) {
      const { candidate } = pick;
      const picks = games.get(candidate.eventId) ?? [];
      picks.push(pick);
      games.set(candidate.eventId, picks);
    }
    return [...games.values()]
      .map((picks) => ({
        event: picks[0].candidate,
        picks: picks.sort(
          (a, b) =>
            b.candidate.fairProbability - a.candidate.fairProbability ||
            b.candidate.expectedValue - a.candidate.expectedValue,
        ),
      }))
      .sort(
        (a, b) =>
          new Date(a.event.commenceTime) - new Date(b.event.commenceTime),
      );
  }, [filteredPlayerProps]);
  const anytimeTdParlays = board?.anytimeTouchdownParlays ?? [];
  const visibleAnytimeTdParlays = selectedTeam
    ? anytimeTdParlays.filter((parlay) =>
        parlay.legs.some(
          (leg) => leg.playerTeam === selectedTeam || leg.opponent === selectedTeam,
        ),
      )
    : anytimeTdParlays;
  const visibleParlays = selectedTeam
    ? parlays.filter((parlay) =>
        parlay.legs.some(
          (leg) => leg.homeTeam === selectedTeam || leg.awayTeam === selectedTeam,
        ),
      )
    : parlays;
  const tierParlays = visibleParlays.filter((parlay) => parlay.tier === parlayTier);
  const gamesWithOdds = filteredGames.map((game) => ({
    game,
    oddsEvent: matchOdds(game, oddsEvents),
  }));
  const upcomingCount = board?.games?.length ?? 0;
  const trackedTeams = board?.trends?.length ?? 0;
  const activeLabel =
    DESK_VIEWS.find((view) => view.key === activeView)?.label ?? "Overview";

  return (
    <main className="app-shell" data-view={activeView}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Vise home">
          <span className="brand-mark">V</span>
          <span className="brand-name">VISE<span>.</span></span>
        </a>
        <div className="sidebar-label">THE DESK</div>
        <nav className="desk-sidebar-nav" aria-label="Research views">
          {DESK_VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              className={`nav-item${activeView === key ? " active" : ""}`}
              key={key}
              onClick={() => navigateView(key)}
              aria-current={activeView === key ? "page" : undefined}
            >
              <Icon size={17} />
              <span>{label}</span>
              {activeView === key && <span className="nav-active-mark" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-heading">
          <span>TEAM TRENDS</span>
          <span className="team-count">{trackedTeams || 32}</span>
        </div>
        <label className="team-search">
          <Search size={14} />
          <input
            aria-label="Search NFL teams"
            placeholder="Find a team"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="team-list">
          {filteredTeams.map((group) => (
            <section className="team-group" key={group.division}>
              <h2>{group.division}</h2>
              {group.teams.map((team) => {
                const record = trendsByName.get(team.toLowerCase());
                const selected = selectedTeam === team;
                return (
                  <button
                    className={`team-link${selected ? " selected" : ""}`}
                    key={team}
                    onClick={() => setSelectedTeam(selected ? "" : team)}
                  >
                    <span>{team}</span>
                    {record ? (
                      <span className="team-mini-record">{record.wins}-{record.losses}</span>
                    ) : (
                      <span className="team-mini-record muted">—</span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">M</span>
          <span className="profile-label">MY WORKSPACE</span>
          <ChevronDown size={14} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <a className="mobile-brand" href="/" aria-label="Vise home">
            <span className="brand-mark">V</span>
            <span className="brand-name">VISE<span>.</span></span>
          </a>
          <div className="breadcrumb">NFL <span>/</span> {activeLabel.toUpperCase()}</div>
          <div className="topbar-right">
            <span className="season-pill">{board?.season ?? new Date().getFullYear()} SEASON</span>
            <span className={`live-pill${board?.oddsConfigured ? " live" : ""}`}>
              <span className="status-dot" />
              {board?.oddsConfigured ? "ODDS KEY SET" : "ODDS NOT CONNECTED"}
            </span>
            <button className="refresh-button" onClick={loadBoard} aria-label="Refresh data">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>

        <div className="content">
          {activeView === "overview" && <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><span /> YOUR NFL MARKET DESK</div>
              <h1>Read the game.<br /><em>Not the noise.</em></h1>
              <p>
                Real-time lines, team form, and matchup context. Your research starts here.
              </p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => navigateView("games")}>
                  Explore matchups <ArrowDownRight size={16} />
                </button>
                <span className="hero-note"><Shield size={14} /> Research, not recommendations</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-ring ring-one" />
              <div className="art-ring ring-two" />
              <div className="art-ring ring-three" />
              <div className="art-ball">V</div>
              <div className="art-tag">EST. 2026 <span>·</span> NFL</div>
              <div className="art-spark"><Sparkles size={15} /></div>
            </div>
            <div className="hero-index">01 — 04</div>
          </section>}

          <section className="stats-row" aria-label="NFL board summary">
            <div className="stat-card">
              <div className="stat-top"><span>UPCOMING GAMES</span><Trophy size={15} /></div>
              <div className="stat-value">{loading ? "—" : String(upcomingCount).padStart(2, "0")}<small> THIS WEEK</small></div>
              <div className="stat-caption">Schedule from ESPN</div>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>TEAMS TRACKED</span><Activity size={15} /></div>
              <div className="stat-value">32<small> NFL TEAMS</small></div>
              <div className="stat-caption">{trackedTeams ? `${trackedTeams} teams with current-season results` : "Records populate as games are played"}</div>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>SPORTSBOOK LINES</span><Radio size={15} /></div>
              <div className={`stat-value ${board?.oddsConfigured ? "accent-value" : ""}`}>
                {board?.oddsConfigured ? oddsEvents.length : "—"}<small> {board?.oddsConfigured ? "GAMES PRICED" : "AWAITING API KEY"}</small>
              </div>
              <div className="stat-caption">{board?.oddsConfigured ? "Live feed · odds refresh every 15m" : "Connect an Odds API key to view lines"}</div>
            </div>
            <div className="stat-card trend-stat">
              <div className="stat-top"><span>DATA REFRESH</span><Clock3 size={15} /></div>
              <div className="stat-value refresh-time">
                {board?.updatedAt
                  ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(board.updatedAt))
                  : "—"}
                <small> LOCAL</small>
              </div>
              <div className="stat-caption">Auto-refreshes every 60 seconds</div>
            </div>
          </section>

          {error && (
            <div className="notice" role="status">
              <CircleHelp size={16} />
              <span>{error}</span>
              {!board?.oddsConfigured && (
                <button className="notice-link" onClick={() => setSetupOpen(true)}>
                  Connect odds <ArrowUpRight size={13} />
                </button>
              )}
            </div>
          )}

          {activeView === "props" && (
            <section className="player-props-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow section-eyebrow"><span /> PLAYER MARKET RESEARCH</div>
                  <h2>
                    {playerPropMarket === "td-parlays" ? "Anytime TD parlays" : "Player props"}
                    <span className="heading-count">
                      {playerPropMarket === "td-parlays"
                        ? visibleAnytimeTdParlays.length
                        : filteredPlayerProps.length}
                    </span>
                  </h2>
                </div>
                <span className="trend-caption">
                  Hard Rock Bet · DraftKings · FanDuel · Caesars (where available) · cached 6h
                </span>
              </div>
              <div className="analysis-disclaimer">
                <CircleHelp size={14} />
                <span>
                  Prices are compared across Hard Rock Bet, DraftKings, FanDuel, and Caesars where offered. Research includes ESPN player totals, team scoring/defense, closing-line home/away ATS records, injuries, and related news.
                </span>
              </div>
              <div className="prop-market-tabs" role="tablist" aria-label="Player prop market">
                {PLAYER_PROP_MARKETS.map((market) => (
                  <button
                    className={playerPropMarket === market.key ? "selected" : ""}
                    key={market.key}
                    onClick={() => setPlayerPropMarket(market.key)}
                    role="tab"
                    aria-selected={playerPropMarket === market.key}
                  >
                    {market.label}
                  </button>
                ))}
              </div>
              {playerPropMarket === "td-parlays" ? (
                <>
                  <div className="analysis-disclaimer prop-parlay-disclaimer">
                    <CircleHelp size={14} />
                    <span>
                      Ideas are ranked using live anytime-TD prices, each offense's
                      season points per game, and the opponent's points allowed per
                      game. Known out, doubtful, and injured-reserve players are
                      excluded. Ranking is a research aid, not a scoring prediction.
                    </span>
                  </div>
                  <div className="parlay-grid td-parlay-grid">
                    {loading && <div className="loading-state">Comparing current team trends and touchdown markets…</div>}
                    {!loading && visibleAnytimeTdParlays.map((parlay, index) => (
                      <AnytimeTdParlayCard
                        key={`${parlay.legCount}-${parlay.legs.map((leg) => leg.eventId + leg.player).join("-")}`}
                        parlay={parlay}
                        index={index}
                      />
                    ))}
                    {!loading && visibleAnytimeTdParlays.length === 0 && (
                      <div className="empty-state">
                        <Sparkles size={22} />
                        <strong>No trend-supported anytime-TD parlays available</strong>
                        <span>Parlays need priced anytime-TD props, current team scoring and opponent defensive data, and available player status.</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="prop-game-list">
                  {loading && <div className="loading-state">Loading current-season player research…</div>}
                  {!loading && propsByGame.map(({ event, picks }) => (
                    <details className="prop-game-group" key={event.eventId}>
                      <summary>
                        <span className="prop-game-time">{formatDate(event.commenceTime)}</span>
                        <strong>{event.awayTeam} @ {event.homeTeam}</strong>
                        <span className="prop-game-count">
                          {picks.length} {picks.length === 1 ? "prop" : "props"}
                        </span>
                      </summary>
                      <div className="prop-grid">
                        {picks.map((pick) => (
                          <PlayerPropCard
                            key={`${pick.candidate.eventId}-${pick.candidate.player}-${pick.candidate.marketKey}`}
                            pick={pick}
                          />
                        ))}
                      </div>
                    </details>
                  ))}
                  {!loading && filteredPlayerProps.length === 0 && (
                  <div className="empty-state">
                    <Sparkles size={22} />
                    <strong>No consensus props available for this market</strong>
                    <span>Sportsbooks may not have posted this market yet, or fewer than two books have matching prices.</span>
                  </div>
                  )}
                </div>
              )}
            </section>
          )}

          {activeView === "news" && (
            <NflNewsSection
              articles={board?.news ?? []}
              updatedAt={board?.newsUpdatedAt}
            />
          )}

          {(activeView === "overview" || activeView === "picks") && (
          <section className="analysis-section" id="smart-analysis">
            {activeView === "overview" && (
              <>
                <PickOfWeekCard pickOfWeek={board?.pickOfWeek} />
                <PickOfWeekRecord record={board?.pickOfWeekRecord} />
                <div className="overview-links">
                  <div>
                    <div className="eyebrow section-eyebrow"><span /> YOUR RESEARCH WORKSPACE</div>
                    <h2>Where do you want to dig in?</h2>
                  </div>
                  <div className="overview-link-grid">
                    {DESK_VIEWS.filter((view) => view.key !== "overview").map(({ key, label, icon: Icon }) => (
                      <button key={key} onClick={() => navigateView(key)}>
                        <Icon size={16} />
                        <span>{label}</span>
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {activeView === "picks" && (
              <div className="research-tabs" role="tablist" aria-label="Game research view">
                <button
                  className={pickTab === "smart" ? "selected" : ""}
                  onClick={() => setPickTab("smart")}
                  role="tab"
                  aria-selected={pickTab === "smart"}
                >
                  Smart game picks
                </button>
                <button
                  className={pickTab === "parlays" ? "selected" : ""}
                  onClick={() => setPickTab("parlays")}
                  role="tab"
                  aria-selected={pickTab === "parlays"}
                >
                  Parlay ideas
                </button>
              </div>
            )}
            {activeView === "picks" && pickTab === "smart" && (
              <>
            <div className="section-heading analysis-heading">
              <div>
                <div className="eyebrow section-eyebrow"><span /> MARKET-DERIVED RESEARCH</div>
                <h2>Smart game picks <span className="heading-count">{filteredGames.length}</span></h2>
              </div>
              <span className="trend-caption">Hard Rock Bet · DraftKings · FanDuel · Caesars (where available)</span>
            </div>
            <div className="analysis-disclaimer">
              <CircleHelp size={14} />
              <span>
                This is price comparison, not a game prediction. “Fair chance” and expected return are
                derived from the available market consensus—not an independent model or a guarantee.
              </span>
            </div>
            <div className="smart-grid">
              {loading && <div className="loading-state">Calculating market comparisons…</div>}
              {!loading && filteredGames.map((game) => (
                <SmartBetCard
                  game={game}
                  key={game.id}
                  smartBet={matchSmartBet(game, smartBets)}
                />
              ))}
              {!loading && filteredGames.length === 0 && (
                <div className="empty-state">
                  <Activity size={22} />
                  <strong>No upcoming games to analyze</strong>
                  <span>Market comparisons appear when upcoming game lines are available.</span>
                </div>
              )}
            </div>
              </>
            )}

            {activeView === "picks" && pickTab === "parlays" && (
              <>
            <div className="parlay-heading">
              <div>
                <div className="eyebrow section-eyebrow"><span /> MULTI-GAME BUILDER</div>
                <h3>Parlay ideas</h3>
              </div>
              <span className="trend-caption">2- and 3-leg combinations · selected books only</span>
            </div>
            <div className="parlay-tabs" role="tablist" aria-label="Parlay style">
              <button
                className={parlayTier === "higher-payout" ? "selected" : ""}
                onClick={() => setParlayTier("higher-payout")}
                role="tab"
                aria-selected={parlayTier === "higher-payout"}
              >
                More return
              </button>
              <button
                className={parlayTier === "higher-hit-rate" ? "selected" : ""}
                onClick={() => setParlayTier("higher-hit-rate")}
                role="tab"
                aria-selected={parlayTier === "higher-hit-rate"}
              >
                Higher hit rate
              </button>
            </div>
            <div className="analysis-disclaimer parlay-disclaimer">
              <Shield size={14} />
              <span>
                {parlayTier === "higher-payout"
                  ? "These combinations include spreads or totals and are ranked by potential payout. Bigger prices generally mean lower estimated chances."
                  : "These combinations prioritize higher market-implied chances. They may be lower-return favorites and are not guarantees."}
                {" "}                Combined prices multiply listed individual odds and may differ from a sportsbook's quoted parlay.
                {" "}Hit-rate estimates multiply probabilities from separate games and are not guarantees.
              </span>
            </div>
            <div className="parlay-grid">
              {!loading && tierParlays.map((parlay, index) => (
                <ParlayCard
                  index={index}
                  key={`${parlay.legCount}-${parlay.bookmaker}-${parlay.legs.map((leg) => leg.eventId).join("-")}`}
                  parlay={parlay}
                />
              ))}
              {!loading && tierParlays.length === 0 && (
                <div className="empty-state">
                  <Trophy size={22} />
                  <strong>
                    {parlayTier === "higher-payout"
                      ? "No spread or total parlays available yet"
                      : "Higher hit-rate parlays are not available yet"}
                  </strong>
                  <span>
                    {selectedTeam
                      ? "No displayed parlay currently includes this team."
                      : "They need live prices from at least two sportsbooks for multiple games."}
                  </span>
                </div>
              )}
            </div>
              </>
            )}
          </section>
          )}

          {activeView === "games" && <section className="matchups-section" id="matchups">
            <div className="section-heading">
              <div>
                <div className="eyebrow section-eyebrow"><span /> THE BOARD</div>
                <h2>{selectedTeam || `Week ${board?.week ?? "—"} matchups`}<span className="heading-count">{filteredGames.length}</span></h2>
              </div>
              <div className="market-controls">
                <span className="control-label"><SlidersHorizontal size={13} /> VIEW MARKET</span>
                <div className="market-tabs">
                  {MARKETS.map((market) => (
                    <button
                      className={marketKey === market.key ? "selected" : ""}
                      key={market.key}
                      onClick={() => setMarketKey(market.key)}
                    >
                      {market.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="analysis-disclaimer bookmaker-scope-note">
              <CircleHelp size={14} />
              <span>Comparisons use Hard Rock Bet, DraftKings, FanDuel, and Caesars where available. ATS records use completed games with a verified ESPN closing spread.</span>
            </div>
            <label className="mobile-team-filter">
              <span>FILTER TEAM</span>
              <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                <option value="">All NFL teams</option>
                {ALL_TEAMS.map((team) => <option key={team} value={team}>{team}</option>)}
              </select>
            </label>
            {!board?.oddsConfigured && (
              <div className="connection-banner">
                <div className="connection-icon"><Radio size={17} /></div>
                <div>
                  <strong>Bring the live market into view</strong>
                  <p>Connect an Odds API key to compare US sportsbook lines. Game odds refresh every 15 minutes and player props every six hours; check your plan's credit allowance.</p>
                </div>
                <button className="setup-link" onClick={() => setSetupOpen(!setupOpen)}>
                  {setupOpen ? "Hide setup" : "Setup guide"} <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            {setupOpen && (
              <div className="setup-panel">
                <strong>Connect live sportsbook prices</strong>
                <ol>
                  <li>Create an API key and choose a plan with enough credits for your expected usage on <a href="https://the-odds-api.com/" target="_blank" rel="noreferrer">The Odds API <ExternalLink size={11} /></a>.</li>
                  <li>Copy <code>.env.example</code> to <code>.env</code> in the project folder.</li>
                  <li>Set <code>ODDS_API_KEY=your_key</code> and restart <code>npm run dev</code>.</li>
                </ol>
                <span>Game odds refresh every 15 minutes and player props every six hours. Your key stays on the backend and is never sent to the browser.</span>
              </div>
            )}
            <div className="games-grid">
              {loading && <div className="loading-state">Loading live NFL schedule…</div>}
              {!loading && gamesWithOdds.map(({ game, oddsEvent }) => (
                <GameCard
                  key={game.id}
                  game={{
                    ...game,
                    away: {
                      ...game.away,
                      record: trendsByName.get(game.away?.name?.toLowerCase()),
                    },
                    home: {
                      ...game.home,
                      record: trendsByName.get(game.home?.name?.toLowerCase()),
                    },
                  }}
                  oddsEvent={oddsEvent}
                  marketKey={marketKey}
                />
              ))}
              {!loading && gamesWithOdds.length === 0 && (
                <div className="empty-state">
                  <Trophy size={22} />
                  <strong>{selectedTeam ? "No upcoming game found for this team" : "No upcoming games found"}</strong>
                  <span>{selectedTeam ? "Select the team again to clear the filter." : "The schedule will appear when the next games are posted."}</span>
                  {selectedTeam && <button onClick={() => setSelectedTeam("")}>Clear team filter</button>}
                </div>
              )}
            </div>
            <div className="source-note">
              <span>DATA SOURCES</span>
              <span>ESPN schedule & results</span>
              <i />
              <span>The Odds API · Hard Rock Bet / DraftKings / FanDuel / Caesars (where available)</span>
              <span className="source-updated">
                {board?.oddsUpdatedAt
                  ? `Odds refreshed ${formatDate(board.oddsUpdatedAt)}`
                  : `Board refreshed ${board?.updatedAt ? formatDate(board.updatedAt) : "—"}`}
              </span>
            </div>
          </section>}

          {activeView === "teams" && <section className="team-trends-section" id="team-form">
            <div className="section-heading compact-heading">
              <div>
                <div className="eyebrow section-eyebrow"><span /> SEASON SO FAR</div>
                <h2>Team form <span className="heading-count">32</span></h2>
              </div>
              <span className="trend-caption">W–L record · point differential · last 5 results</span>
            </div>
            <div className="trend-grid">
              {TEAM_GROUPS.flatMap((group) => group.teams).map((team) => {
                const record = trendsByName.get(team.toLowerCase());
                return (
                  <button
                    className="trend-row"
                    key={team}
                    onClick={() => setSelectedTeam(selectedTeam === team ? "" : team)}
                  >
                    <span className="trend-team">{team}</span>
                    <TeamRecord record={record} />
                    <span className={`point-diff${record?.pointDifferential > 0 ? " positive" : record?.pointDifferential < 0 ? " negative" : ""}`}>
                      {record ? `${record.pointDifferential > 0 ? "+" : ""}${record.pointDifferential}` : "—"}
                    </span>
                    <span className="form-dots">
                      {Array.from({ length: 5 }, (_, index) => {
                        const result = record?.recent?.[4 - index];
                        return <i className={result ? result.toLowerCase() : "empty"} key={index} title={result ?? "No result"} />;
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>}

          <footer className="footer">
            <span className="footer-brand">VISE<span>.</span></span>
            <span>Independent research tool. Not betting advice.</span>
            <span>Know your limits. 21+ only.</span>
          </footer>
        </div>
      </section>

      <nav className="mobile-nav" aria-label="Main navigation">
        {DESK_VIEWS.map(({ key, label, icon: Icon }) => (
          <button
            className={activeView === key ? "active" : ""}
            key={key}
            onClick={() => navigateView(key)}
            aria-current={activeView === key ? "page" : undefined}
          >
            <Icon size={15} />
            <span>{label === "Player props" ? "Props" : label === "Game picks" ? "Picks" : label === "Game lines" ? "Lines" : label === "Team form" ? "Teams" : label === "NFL News" ? "News" : "Home"}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
