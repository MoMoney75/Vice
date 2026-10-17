import express from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  analyzeOdds,
  buildPickOfWeek,
  filterOddsToGames,
} from "./market-analysis.js";
import {
  analyzePlayerProps,
  buildAnytimeTouchdownParlays,
  PROP_MARKETS,
} from "./player-props.js";
import { mapNflNews } from "./nfl-news.js";
import { buildAgainstTheSpreadRecords } from "./against-the-spread.js";
import { filterToSupportedSportsbooks } from "./sportsbook-filter.js";
import {
  resolvePickOfWeekLock,
  settlePickOfWeekLock,
  summarizePickOfWeekRecord,
} from "./pick-of-week-lock.js";
import {
  describeOddsQuotaFailure,
  isTransientNetworkFailure,
  shouldRestoreFailure,
} from "./cache-utils.js";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const app = express();
const port = Number(process.env.PORT) || 3001;
const root = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
const failedFetches = new Map();
const inFlightFetches = new Map();
const cacheFile = path.resolve(root, "../.vice-cache.json");
const oddsApiKeyFingerprint = process.env.ODDS_API_KEY
  ? createHash("sha256").update(process.env.ODDS_API_KEY).digest("hex")
  : null;
const CACHE_TTL_MS = 60_000;
const ODDS_CACHE_TTL_MS = 15 * 60 * 1000;
const ODDS_QUOTA_CACHE_TTL_MS = 5 * 60 * 1000;
const INJURY_CACHE_TTL_MS = 60 * 60 * 1000;
const PLAYER_STATS_CACHE_TTL_MS = 60 * 60 * 1000;
const PLAYER_PROP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 30 * 60 * 1000;
const ATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ROSTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_INJURIES =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const ESPN_PLAYER_STATS =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/statistics";
const ESPN_NEWS =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=30";
const ESPN_EVENT_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const ESPN_TEAM_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ODDS_URL =
  "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds";
const ODDS_SPORTS_URL = "https://api.the-odds-api.com/v4/sports";
const ODDS_EVENT_URL =
  "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events";
const PLAYER_PROP_MARKETS = Object.keys(PROP_MARKETS).join(",");
const NFL_TEAM_ABBREVIATIONS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS", "WSH",
]);
const LAST_REGULAR_SEASON_WEEK = 18;
const INJURY_PRIORITY = {
  Out: 0,
  Doubtful: 1,
  "Injured Reserve": 2,
  "Physically Unable to Perform": 3,
  Questionable: 4,
  "Day-To-Day": 5,
};
let oddsCreditsRemaining = null;
let reservedOddsCredits = 0;
let cacheWrite = Promise.resolve();
let cacheWriteTimer = null;

function isPersistentCacheKey(key) {
  return key === "odds-quota" ||
    key === "odds" ||
    key.startsWith("player-props-") ||
    key.startsWith("pick-of-week-");
}

if (existsSync(cacheFile)) {
  try {
    const stored = JSON.parse(readFileSync(cacheFile, "utf8"));
    const oddsApiKeyMatches = stored.oddsApiKeyFingerprint === oddsApiKeyFingerprint;
    for (const [key, value] of stored.entries ?? []) {
      if (
        key.startsWith("pick-of-week-") ||
        (oddsApiKeyMatches && isPersistentCacheKey(key))
      ) {
        cache.set(key, value);
      }
    }
    if (oddsApiKeyMatches) {
      for (const [key, value] of stored.failures ?? []) {
        if (
          isPersistentCacheKey(key) &&
          shouldRestoreFailure(value)
        ) {
          failedFetches.set(key, value);
        }
      }
      oddsCreditsRemaining = Number.isFinite(stored.oddsCreditsRemaining)
        ? stored.oddsCreditsRemaining
        : null;
    } else {
      console.log("Odds API key changed; discarding cached odds and quota state while retaining weekly pick locks.");
    }
  } catch (error) {
    console.error(`Unable to read local Vice cache: ${error.message}`);
  }
}

function persistCache() {
  if (cacheWriteTimer) clearTimeout(cacheWriteTimer);
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = null;
    const contents = JSON.stringify({
      entries: [...cache.entries()].filter(([key]) => isPersistentCacheKey(key)),
      failures: [...failedFetches.entries()].filter(([key]) => isPersistentCacheKey(key)),
      oddsCreditsRemaining,
      oddsApiKeyFingerprint,
    });
    cacheWrite = cacheWrite
      .then(() => writeFile(cacheFile, contents, "utf8"))
      .catch((error) => {
        console.error(`Unable to persist local Vice cache: ${error.message}`);
      });
  }, 100);
  return cacheWrite;
}

function currentSeasonYear() {
  const now = new Date();
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

function canonicalPlayerName(name) {
  return name?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function cachedFetch(key, url, headers = {}, ttlMs = CACHE_TTL_MS) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.savedAt < ttlMs) {
    return cached.value;
  }
  const cachedFailure = failedFetches.get(key);
  if (cachedFailure && now < cachedFailure.expiresAt) {
    throw new Error(cachedFailure.message);
  }
  if (cachedFailure) failedFetches.delete(key);
  const pending = inFlightFetches.get(key);
  if (pending) return pending;

  const requestUrl = new URL(url);
  const isOddsApi = requestUrl.hostname === "api.the-odds-api.com";
  const isSportsList = /^\/v4\/sports\/?$/.test(requestUrl.pathname);
  const marketCount = (requestUrl.searchParams.get("markets") ?? "h2h").split(",").length;
  const regionCount = (requestUrl.searchParams.get("regions") ?? "us").split(",").length;
  const expectedCredits = isOddsApi && !isSportsList ? marketCount * regionCount : 0;
  const request = (async () => {
    if (
      expectedCredits &&
      oddsCreditsRemaining !== null &&
      oddsCreditsRemaining - reservedOddsCredits < expectedCredits
    ) {
      throw new Error(
        `The Odds API balance has ${Math.max(0, oddsCreditsRemaining - reservedOddsCredits)} credits remaining; ${expectedCredits} are needed.`,
      );
    }

    reservedOddsCredits += expectedCredits;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      const remainingHeader = response.headers.get("x-requests-remaining");
      const remaining = remainingHeader === null ? null : Number(remainingHeader);
      if (Number.isFinite(remaining)) {
        oddsCreditsRemaining = isSportsList || oddsCreditsRemaining === null
          ? remaining
          : Math.min(oddsCreditsRemaining, remaining);
      }
      if (!response.ok) {
        const details = await response.text();
        let message = `Upstream request failed (${response.status})`;
        try {
          const body = JSON.parse(details);
          if (body.message) message += `: ${body.message}`;
        } catch {
          if (details) message += `: ${details.slice(0, 200)}`;
        }
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      const value = await response.json();
      cache.set(key, { value, savedAt: Date.now() });
      failedFetches.delete(key);
      await persistCache();
      return value;
    } finally {
      reservedOddsCredits -= expectedCredits;
    }
  })();
  inFlightFetches.set(key, request);

  try {
    return await request;
  } catch (error) {
    const failureTtlMs = isTransientNetworkFailure(error.message)
      ? Math.min(ttlMs, 15_000)
      : ttlMs;
    failedFetches.set(key, {
      message: error.message,
      expiresAt: Date.now() + failureTtlMs,
    });
    await persistCache();
    throw error;
  } finally {
    inFlightFetches.delete(key);
  }
}

function getTeam(competitors, homeAway) {
  const competitor = competitors.find((item) => item.homeAway === homeAway);
  return competitor
    ? {
        id: competitor.team.id,
        name: competitor.team.displayName,
        abbreviation: competitor.team.abbreviation,
        score: competitor.score ?? null,
      }
    : null;
}

function mapGame(event) {
  const competition = event.competitions?.[0];
  if (!competition) return null;
  const competitors = competition.competitors ?? [];
  const status = competition.status ?? event.status;
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    status: status?.type?.shortDetail ?? status?.type?.detail ?? "Scheduled",
    completed: Boolean(status?.type?.completed),
    home: getTeam(competitors, "home"),
    away: getTeam(competitors, "away"),
  };
}

function makeTeamTrends(games) {
  const records = new Map();
  for (const game of games) {
    if (
      !game.completed ||
      !game.home ||
      !game.away ||
      !NFL_TEAM_ABBREVIATIONS.has(game.home.abbreviation) ||
      !NFL_TEAM_ABBREVIATIONS.has(game.away.abbreviation)
    ) continue;
    const homeScore = Number(game.home.score);
    const awayScore = Number(game.away.score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    for (const [team, opponent, scored, allowed] of [
      [game.home, game.away, homeScore, awayScore],
      [game.away, game.home, awayScore, homeScore],
    ]) {
      const stats = records.get(team.id) ?? {
        id: team.id,
        name: team.name,
        abbreviation: team.abbreviation,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        recent: [],
      };
      const result = scored > allowed ? "W" : scored < allowed ? "L" : "T";
      if (result === "W") stats.wins += 1;
      else if (result === "L") stats.losses += 1;
      else stats.ties += 1;
      stats.pointsFor += scored;
      stats.pointsAgainst += allowed;
      stats.recent.push({
        date: game.date,
        result,
        pointsFor: scored,
        pointsAgainst: allowed,
        opponent: opponent.name,
      });
      records.set(team.id, stats);
    }

  }

  return [...records.values()].map((team) => {
    const recentGames = team.recent
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    return {
      ...team,
      pointDifferential: team.pointsFor - team.pointsAgainst,
      recent: recentGames.map(({ result }) => result),
      recentGames,
    };
  });
}

async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await Promise.resolve()
          .then(() => callback(items[index], index))
          .then(
            (value) => ({ status: "fulfilled", value }),
            (reason) => ({ status: "rejected", reason }),
          );
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function canonicalTeamName(name) {
  return name
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function mapInjuryReport(report) {
  const teams = new Map();
  const playerStatuses = {};
  for (const team of report.injuries ?? []) {
    const injuries = (team.injuries ?? [])
      .filter((injury) => injury.status && injury.status !== "Active")
      .map((injury) => ({
        player: injury.athlete?.displayName ?? "Player",
        position: injury.athlete?.position?.abbreviation ?? null,
        status: injury.status,
        detail: injury.shortComment ?? injury.details?.detail ?? null,
        updatedAt: injury.date ?? null,
      }))
      .sort((a, b) => {
        const positionPriority = (status) => INJURY_PRIORITY[status] ?? 6;
        const severity = positionPriority(a.status) - positionPriority(b.status);
        if (severity) return severity;
        return (a.position === "QB" ? -1 : 0) - (b.position === "QB" ? -1 : 0);
      });
    for (const injury of injuries) {
      playerStatuses[canonicalTeamName(injury.player)] = {
        ...injury,
        team: team.displayName,
      };
    }
    teams.set(canonicalTeamName(team.displayName), {
      team: team.displayName,
      reportedCount: injuries.length,
      players: injuries.slice(0, 4),
    });
  }
  return {
    updatedAt: report.timestamp ?? null,
    teams: Object.fromEntries(teams),
    playerStatuses,
  };
}

app.get("/api/nfl/board", async (_request, response) => {
  const season = currentSeasonYear();
  let oddsQuotaReady = false;
  let oddsQuotaError = false;
  let oddsQuotaResult;
  if (process.env.ODDS_API_KEY) {
    [oddsQuotaResult] = await Promise.allSettled([
      cachedFetch(
        "odds-quota",
        `${ODDS_SPORTS_URL}?apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`,
        {},
        ODDS_QUOTA_CACHE_TTL_MS,
      ),
    ]);
    oddsQuotaReady =
      oddsQuotaResult.status === "fulfilled" && Number.isFinite(oddsCreditsRemaining);
    oddsQuotaError = oddsQuotaResult.status === "rejected";
  }
  const [scoreboardResult, oddsResult, injuryResult, statsResult, newsResult] = await Promise.allSettled([
    cachedFetch(`scoreboard-current-${season}`, ESPN_SCOREBOARD),
    process.env.ODDS_API_KEY && oddsQuotaReady && oddsCreditsRemaining >= 3
      ? cachedFetch(
          "odds",
          `${ODDS_URL}?regions=us&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso&apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`,
          {},
          ODDS_CACHE_TTL_MS,
        )
      : Promise.resolve(null),
    cachedFetch("injuries", ESPN_INJURIES, {}, INJURY_CACHE_TTL_MS),
    cachedFetch("player-stats", ESPN_PLAYER_STATS, {}, PLAYER_STATS_CACHE_TTL_MS),
    cachedFetch("nfl-news", ESPN_NEWS, {}, NEWS_CACHE_TTL_MS),
  ]);

  const errors = [];
  if (oddsQuotaError || (process.env.ODDS_API_KEY && !oddsQuotaReady)) {
    errors.push(
      describeOddsQuotaFailure(oddsQuotaResult, process.env.ODDS_API_KEY),
    );
  } else if (process.env.ODDS_API_KEY && oddsCreditsRemaining < 3) {
    errors.push(`The Odds API balance is ${oddsCreditsRemaining} credits; at least 3 are needed for current game lines.`);
  }
  const currentScoreboard =
    scoreboardResult.status === "fulfilled" ? scoreboardResult.value : null;
  if (!currentScoreboard) errors.push("NFL schedule and results are temporarily unavailable.");
  if (oddsResult.status === "rejected" && oddsQuotaReady) {
    errors.push("Live sportsbook odds are temporarily unavailable.");
  }
  const injuryReport =
    injuryResult.status === "fulfilled"
      ? mapInjuryReport(injuryResult.value)
      : null;
  if (!injuryReport) {
    errors.push("The latest injury report is temporarily unavailable.");
  }
  const playerStatistics =
    statsResult.status === "fulfilled" ? statsResult.value : null;
  if (!playerStatistics) {
    errors.push("Current-season ESPN player statistics are temporarily unavailable.");
  }
  const news = newsResult.status === "fulfilled"
    ? mapNflNews(newsResult.value)
    : [];
  if (newsResult.status === "rejected") {
    errors.push("The latest NFL news feed is temporarily unavailable.");
  }

  let games = [];
  let currentWeekSchedule = [];
  const week = currentScoreboard?.week?.number ?? null;
  if (currentScoreboard && week) {
    const finalWeek = Math.min(week + 1, LAST_REGULAR_SEASON_WEEK);
    const weekResults = await Promise.allSettled(
      Array.from({ length: finalWeek }, (_, index) => index + 1).map((gameWeek) =>
        cachedFetch(
          `scoreboard-${season}-week-${gameWeek}`,
          `${ESPN_SCOREBOARD}?week=${gameWeek}&seasontype=2`,
        ),
      ),
    );
    const allEvents = new Map();
    for (const result of weekResults) {
      if (result.status === "rejected") {
        errors.push("Some NFL game results could not be loaded.");
        continue;
      }
      for (const event of result.value.events ?? []) allEvents.set(event.id, event);
    }
    for (const event of currentScoreboard.events ?? []) allEvents.set(event.id, event);
    const weekData = weekResults[week - 1];
    const weekEvents =
      weekData?.status === "fulfilled"
        ? weekData.value.events ?? []
        : currentScoreboard.events ?? [];
    const scheduleIds = new Set(weekEvents.map((event) => event.id));
    games = [...allEvents.values()].map(mapGame).filter(Boolean);
    currentWeekSchedule = games.filter((game) => scheduleIds.has(game.id));
  }

  const completedSeasonGames = games.filter((game) => game.completed);
  const atsSummaryResults = await mapConcurrent(
    completedSeasonGames,
    6,
    (game) =>
      cachedFetch(
        `ats-summary-${season}-${game.id}`,
        `${ESPN_EVENT_SUMMARY}?event=${encodeURIComponent(game.id)}`,
        {},
        ATS_CACHE_TTL_MS,
      ),
  );
  const atsSummaries = new Map();
  atsSummaryResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      atsSummaries.set(completedSeasonGames[index].id, result.value);
    }
  });
  const atsRecords = buildAgainstTheSpreadRecords(completedSeasonGames, atsSummaries);
  const atsGamesAvailable = Math.round(
    [...atsRecords.values()].reduce(
      (count, record) =>
        count +
        record.home.wins + record.home.losses + record.home.pushes +
        record.away.wins + record.away.losses + record.away.pushes,
      0,
    ) / 2,
  );
  const atsGamesUnavailable = completedSeasonGames.length - atsGamesAvailable;
  if (atsGamesUnavailable > 0) {
    errors.push(
      `Closing-line ATS records cover ${atsGamesAvailable} of ${completedSeasonGames.length} completed games; ${atsGamesUnavailable} closing lines are unavailable.`,
    );
  }

  let settledPickChanged = false;
  const completedGames = new Map(
    games.filter((game) => game.completed).map((game) => [game.id, game]),
  );
  for (const [key, entry] of cache) {
    if (!key.startsWith("pick-of-week-") || !entry.value?.candidate) continue;
    const settled = settlePickOfWeekLock(
      entry.value,
      completedGames.get(entry.value.candidate.eventId),
    );
    if (settled !== entry.value) {
      cache.set(key, { ...entry, value: settled });
      settledPickChanged = true;
    }
  }
  if (settledPickChanged) void persistCache();

  const trends = makeTeamTrends(games).map((team) => ({
    ...team,
    homeAts: atsRecords.get(team.id)?.home ?? null,
    awayAts: atsRecords.get(team.id)?.away ?? null,
  }));
  const now = Date.now();
  const upcoming = (currentWeekSchedule ?? [])
    .filter((game) => {
      const gameTime = new Date(game.date).getTime();
      return !game.completed && gameTime >= now;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const fullOdds = oddsResult.status === "fulfilled" ? oddsResult.value ?? [] : [];
  const odds = filterToSupportedSportsbooks(
    filterOddsToGames(fullOdds, upcoming),
  );
  const analysis = analyzeOdds(odds, { trends, injuryReport, news });
  const propResults = process.env.ODDS_API_KEY && oddsQuotaReady
    ? await Promise.allSettled(
        odds.map((event) =>
          cachedFetch(
            `player-props-${event.id}`,
            `${ODDS_EVENT_URL}/${encodeURIComponent(event.id)}/odds?regions=us&markets=${PLAYER_PROP_MARKETS}&oddsFormat=american&dateFormat=iso&apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`,
            {},
            PLAYER_PROP_CACHE_TTL_MS,
          ),
        ),
      )
    : [];
  const playerPropEvents = [];
  let failedPropEvents = 0;
  propResults.forEach((result, index) => {
    if (result.status === "rejected") {
      failedPropEvents += 1;
      return;
    }
    const event = odds[index];
    playerPropEvents.push({
      ...filterToSupportedSportsbooks([result.value])[0],
      id: event.id,
      name: event.name,
      home_team: event.home_team,
      away_team: event.away_team,
      commence_time: event.commence_time,
    });
  });
  if (failedPropEvents) {
    errors.push(
      `Player prop odds could not be loaded for ${failedPropEvents} upcoming game${failedPropEvents === 1 ? "" : "s"}. The account quota or sportsbook market availability may be limiting coverage.`,
    );
  }
  const rosterTeams = new Map();
  for (const game of upcoming) {
    for (const team of [game.home, game.away]) {
      if (team?.id) rosterTeams.set(team.id, team.name);
    }
  }
  const rosterResults = playerPropEvents.length
    ? await Promise.allSettled(
        [...rosterTeams].map(([teamId]) =>
          cachedFetch(
            `roster-${teamId}`,
            `${ESPN_TEAM_URL}/${encodeURIComponent(teamId)}?enable=roster`,
            {},
            ROSTER_CACHE_TTL_MS,
          ),
        ),
      )
    : [];
  const playerRosters = new Map();
  let failedRosters = 0;
  rosterResults.forEach((result, index) => {
    if (result.status === "rejected") {
      failedRosters += 1;
      return;
    }
    const [teamId, teamName] = [...rosterTeams][index];
    const roster = result.value.team;
    for (const athlete of roster?.athletes ?? []) {
      if (!athlete.displayName) continue;
      playerRosters.set(canonicalPlayerName(athlete.displayName), {
        team: roster.displayName ?? teamName,
        position: athlete.position?.abbreviation ?? null,
      });
    }
    if (!roster) {
      failedRosters += 1;
      return;
    }
  });
  if (failedRosters) {
    errors.push(`ESPN player roster details are unavailable for ${failedRosters} upcoming team${failedRosters === 1 ? "" : "s"}.`);
  }
  const playerProps = analyzePlayerProps(playerPropEvents, {
    statistics: playerStatistics,
    trends,
    injuryReport,
    news,
    playerRosters,
  });
  const anytimeTouchdownParlays = buildAnytimeTouchdownParlays(playerProps, {
    trends,
  });
  const propsSavedAt = Math.max(
    0,
    ...odds.map((event) => cache.get(`player-props-${event.id}`)?.savedAt ?? 0),
  );
  const pickLockKey = week ? `pick-of-week-${season}-${week}` : null;
  const savedPickLock = pickLockKey ? cache.get(pickLockKey)?.value : null;
  const pickLock = week
    ? resolvePickOfWeekLock(analysis, savedPickLock)
    : null;
  if (pickLock && pickLockKey && !savedPickLock) {
    cache.set(pickLockKey, {
      value: {
        candidate: pickLock.candidate,
        selectedAt: pickLock.selectedAt,
      },
      savedAt: Date.now(),
    });
    void persistCache();
  }
  const pickOfWeekRecord = summarizePickOfWeekRecord(
    [...cache.entries()].flatMap(([key, entry]) => {
      const match = /^pick-of-week-(\d+)-(\d+)$/.exec(key);
      return match && entry.value?.candidate
        ? [{
            season: Number(match[1]),
            week: Number(match[2]),
            lock: entry.value,
          }]
        : [];
    }),
  );
  const pickOfWeek = buildPickOfWeek({
    analysis,
    trends,
    injuryReport,
    week,
    news,
    candidate: pickLock?.candidate ?? null,
    selectedAt: pickLock?.selectedAt ?? null,
    priceUpdated: pickLock?.priceUpdated ?? false,
  });
  response.json({
    season,
    week,
    games: upcoming,
    trends,
    odds,
    analysis,
    playerProps,
    anytimeTouchdownParlays,
    playerPropsUpdatedAt: propsSavedAt
      ? new Date(propsSavedAt).toISOString()
      : null,
    playerStatsUpdatedAt: playerStatistics && cache.get("player-stats")?.savedAt
      ? new Date(cache.get("player-stats").savedAt).toISOString()
      : null,
    newsUpdatedAt: newsResult.status === "fulfilled" && cache.get("nfl-news")?.savedAt
      ? new Date(cache.get("nfl-news").savedAt).toISOString()
      : null,
    pickOfWeek,
    pickOfWeekRecord,
    news,
    atsGamesAvailable,
    injuryReportUpdatedAt: injuryReport?.updatedAt ?? null,
    oddsConfigured: Boolean(process.env.ODDS_API_KEY),
    oddsUpdatedAt: cache.get("odds")?.savedAt
      ? new Date(cache.get("odds").savedAt).toISOString()
      : null,
    updatedAt: new Date().toISOString(),
    errors,
  });
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(root, "../dist");
  app.use(express.static(clientDist));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Vice API listening on http://localhost:${port}`);
});
