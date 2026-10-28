import express from "express";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
  buildPlayerDepthChartLookup,
  buildAnytimeTouchdownParlays,
  PROP_MARKETS,
} from "./player-props.js";
import { mapLeagueNews, mapNflNews } from "./nfl-news.js";
import { buildAgainstTheSpreadRecords } from "./against-the-spread.js";
import { buildDefensivePropStats } from "./defensive-prop-stats.js";
import {
  buildBasketballKeyPlayers,
  buildKeyPlayers,
} from "./game-results.js";
import { findGameForPick } from "./pick-game-match.js";
import { filterToSupportedSportsbooks } from "./sportsbook-filter.js";
import {
  resolvePickOfWeekLock,
  settlePickOfWeekLock,
  summarizePickOfWeekRecord,
} from "./pick-of-week-lock.js";
import {
  alignSmartPicksWithPickOfWeek,
  resolveSmartPicks,
  settleSmartPick,
  settleSmartPickHistory,
  summarizeSmartPickRecord,
} from "./smart-pick-lock.js";
import {
  describeOddsQuotaFailure,
  isTransientNetworkFailure,
  oddsRequestCreditCost,
  shouldRestoreFailure,
} from "./cache-utils.js";
import { selectScheduleWeek } from "./week-schedule.js";
import { currentSeasonYear, getSport, getSportPeriod } from "./sport-registry.js";
import {
  makeSportTeamTrends,
  mapOddsScheduleGame,
  mapSportGame,
} from "./sports-data.js";
import { buildDailyScoreboardRequests } from "./sport-schedule.js";

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
const cacheDirectory = path.resolve(
  process.env.VISE_DATA_DIR || path.resolve(root, ".."),
);
mkdirSync(cacheDirectory, { recursive: true });
const cacheFile = path.join(cacheDirectory, ".vice-cache.json");
const legacyCacheFile = path.resolve(root, "../.vice-cache.json");
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
const ODDS_URL = "https://api.the-odds-api.com/v4/sports";
const ODDS_SPORTS_URL = "https://api.the-odds-api.com/v4/sports";
const ODDS_EVENT_URL =
  "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events";
const PLAYER_PROP_MARKETS = Object.keys(PROP_MARKETS).join(",");
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
    key.startsWith("odds-") ||
    key.startsWith("player-props-") ||
    key.startsWith("pick-of-week-") ||
    key.startsWith("smart-picks-") ||
    key.startsWith("nba-pick-of-week-") ||
    key.startsWith("nba-smart-picks-");
}

const cacheSourceFile = existsSync(cacheFile)
  ? cacheFile
  : legacyCacheFile !== cacheFile && existsSync(legacyCacheFile)
    ? legacyCacheFile
    : null;

if (cacheSourceFile) {
  try {
    const stored = JSON.parse(readFileSync(cacheSourceFile, "utf8"));
    const oddsApiKeyMatches = stored.oddsApiKeyFingerprint === oddsApiKeyFingerprint;
    for (const [key, value] of stored.entries ?? []) {
      if (
        key.startsWith("pick-of-week-") ||
        key.startsWith("smart-picks-") ||
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
    if (cacheSourceFile !== cacheFile) {
      console.log(`Migrating Vise cache from ${cacheSourceFile} to ${cacheFile}.`);
      void persistCache();
    }
  } catch (error) {
    console.error(`Unable to read local Vise cache: ${error.message}`);
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
        console.error(`Unable to persist local Vise cache: ${error.message}`);
      });
  }, 100);
  return cacheWrite;
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
  const expectedCredits = oddsRequestCreditCost(requestUrl);
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
        oddsCreditsRemaining = expectedCredits === 0 || oddsCreditsRemaining === null
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
  const season = currentSeasonYear("nfl");
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
          `${ODDS_URL}/${getSport("nfl").oddsApiKey}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso&apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`,
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
  let week = currentScoreboard?.week?.number ?? null;
  if (currentScoreboard && week) {
    const scoreboardWeek = week;
    const finalWeek = Math.min(scoreboardWeek + 1, LAST_REGULAR_SEASON_WEEK);
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
    const currentWeekData = weekResults[scoreboardWeek - 1];
    const currentWeekEvents =
      currentWeekData?.status === "fulfilled"
        ? currentWeekData.value.events ?? []
        : currentScoreboard.events ?? [];
    const nextWeekData = weekResults[scoreboardWeek];
    const nextWeekEvents = nextWeekData?.status === "fulfilled"
      ? nextWeekData.value.events ?? []
      : [];
    const selectedSchedule = selectScheduleWeek(
      scoreboardWeek,
      currentWeekEvents,
      nextWeekEvents,
    );
    week = selectedSchedule.week;
    const scheduleIds = new Set(selectedSchedule.events.map((event) => event.id));
    games = [...allEvents.values()].map(mapSportGame).filter(Boolean);
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
  const keyPlayersByGame = new Map(
    completedSeasonGames.map((game) => [
      game.id,
      buildKeyPlayers(game, atsSummaries.get(game.id)),
    ]),
  );
  const defensivePropStats = buildDefensivePropStats(
    completedSeasonGames,
    atsSummaries,
  );
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
    games
      .filter((game) => game.completed)
      .map((game) => [
        game.id,
        { ...game, keyPlayers: keyPlayersByGame.get(game.id) ?? [] },
      ]),
  );
  const settledSmartPicksChanged = settleSmartPickHistory(
    cache,
    "smart-picks-",
    completedGames.values(),
  );
  for (const [key, entry] of cache) {
    if (!key.startsWith("pick-of-week-") || !entry.value?.candidate) continue;
    const settled = settlePickOfWeekLock(
      entry.value,
      findGameForPick(entry.value.candidate, completedGames.values()),
    );
    if (settled !== entry.value) {
      cache.set(key, { ...entry, value: settled });
      settledPickChanged = true;
    }
  }
  if (settledPickChanged || settledSmartPicksChanged) void persistCache();

  const trends = makeSportTeamTrends(games).map((team) => ({
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
  const smartPickKey = week ? `smart-picks-${season}-${week}` : null;
  const savedSmartPicks = smartPickKey
    ? cache.get(smartPickKey)?.value?.picks ?? []
    : [];
  const resolvedSmartPicks = resolveSmartPicks(analysis, savedSmartPicks);
  let smartPicks = alignSmartPicksWithPickOfWeek(
    resolvedSmartPicks,
    pickLock?.candidate,
  );
  let smartPicksChanged =
    smartPicks.length !== savedSmartPicks.length ||
    smartPicks.some((pick, index) => pick !== resolvedSmartPicks[index]);
  smartPicks = smartPicks.map((pick) => {
    const settled = settleSmartPick(
      pick,
      findGameForPick(pick.candidate, completedGames.values()),
    );
    if (settled !== pick) smartPicksChanged = true;
    return settled;
  });
  if (smartPickKey && smartPicksChanged) {
    cache.set(smartPickKey, {
      value: { picks: smartPicks, periodLabel: `Week ${week}` },
      savedAt: Date.now(),
    });
    void persistCache();
  }
  const smartPickRecord = summarizeSmartPickRecord(
    [...cache.entries()].flatMap(([key, entry]) => {
      const match = /^smart-picks-(\d+)-(\d+)$/.exec(key);
      return match && Array.isArray(entry.value?.picks)
        ? [{
            season: Number(match[1]),
            week: Number(match[2]),
            picks: entry.value.picks,
          }]
        : [];
    }),
  );
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
      ...result.value,
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
  const [rosterResults, depthChartResults] = playerPropEvents.length
    ? await Promise.all([
        Promise.allSettled(
          [...rosterTeams].map(([teamId]) =>
            cachedFetch(
              `roster-${teamId}`,
              `${ESPN_TEAM_URL}/${encodeURIComponent(teamId)}?enable=roster`,
              {},
              ROSTER_CACHE_TTL_MS,
            ),
          ),
        ),
        Promise.allSettled(
          [...rosterTeams].map(([teamId]) =>
            cachedFetch(
              `depth-chart-${teamId}`,
              `${ESPN_TEAM_URL}/${encodeURIComponent(teamId)}/depthcharts`,
              {},
              ROSTER_CACHE_TTL_MS,
            ),
          ),
        ),
      ])
    : [[], []];
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
  let failedDepthCharts = 0;
  depthChartResults.forEach((result, index) => {
    if (result.status === "rejected") {
      failedDepthCharts += 1;
      return;
    }
    const [teamId, teamName] = [...rosterTeams][index];
    const depthChartPlayers = buildPlayerDepthChartLookup(
      result.value,
      rosterTeams.get(teamId) ?? teamName,
    );
    if (!depthChartPlayers.size) {
      failedDepthCharts += 1;
      return;
    }
    for (const [playerKey, depth] of depthChartPlayers) {
      playerRosters.set(playerKey, {
        ...playerRosters.get(playerKey),
        ...depth,
      });
    }
  });
  if (failedDepthCharts) {
    errors.push(`ESPN depth chart ordering is unavailable for ${failedDepthCharts} upcoming team${failedDepthCharts === 1 ? "" : "s"}.`);
  }
  const playerProps = analyzePlayerProps(playerPropEvents, {
    statistics: playerStatistics,
    trends,
    defensiveStatsByTeam: defensivePropStats,
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
    sport: "nfl",
    sportLabel: getSport("nfl").label,
    features: getSport("nfl").features,
    season,
    week,
    games: currentWeekSchedule.map((game) => ({
      ...game,
      keyPlayers: keyPlayersByGame.get(game.id) ?? [],
    })),
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
    smartPicks,
    smartPickRecord,
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

app.get("/api/:sport/board", async (request, response) => {
  const sport = getSport(request.params.sport);
  if (!sport || sport.scheduleType !== "rolling") {
    return response.status(404).json({ error: "Unsupported sport board." });
  }

  const errors = [];
  const now = new Date();
  const season = currentSeasonYear(sport.id, now);
  const period = getSportPeriod(now, sport.id);
  const periodStart = new Date(now);
  periodStart.setHours(0, 0, 0, 0);
  periodStart.setDate(now.getDate() - now.getDay());
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodStart.getDate() + 6);
  const seasonStart = new Date(Date.UTC(season, sport.periodStartMonth, 1));
  const scoreboardRequests = buildDailyScoreboardRequests({
    espnPath: sport.espnPath,
    seasonStart,
    periodEnd,
    now,
  });
  const espnBaseUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport.espnPath}`;

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

  const oddsCacheKey = `odds-${sport.id}`;
  const oddsRequest = process.env.ODDS_API_KEY && oddsQuotaReady && oddsCreditsRemaining >= 3
    ? cachedFetch(
        oddsCacheKey,
        `${ODDS_URL}/${sport.oddsApiKey}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso&apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`,
        {},
        ODDS_CACHE_TTL_MS,
      )
    : Promise.resolve(null);
  const eventScheduleRequest = process.env.ODDS_API_KEY
    ? cachedFetch(
        `events-${sport.id}`,
        `${ODDS_URL}/${sport.oddsApiKey}/events?dateFormat=iso&apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`,
        {},
        ODDS_CACHE_TTL_MS,
      )
    : Promise.resolve(null);
  const [scoreboardResults, oddsResult, eventScheduleResult, injuryResult, newsResult] = await Promise.all([
    mapConcurrent(scoreboardRequests, 6, ({ key, url, ttlMs }) =>
      cachedFetch(
        `scoreboard-${sport.id}-${season}-${key}`,
        url,
        {},
        ttlMs,
      )),
    oddsRequest.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ),
    eventScheduleRequest.then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ),
    cachedFetch(
      `injuries-${sport.id}`,
      `${espnBaseUrl}/injuries`,
      {},
      INJURY_CACHE_TTL_MS,
    ).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ),
    cachedFetch(
      `news-${sport.id}`,
      `${espnBaseUrl}/news?limit=30`,
      {},
      NEWS_CACHE_TTL_MS,
    ).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ),
  ]);

  if (oddsQuotaError || (process.env.ODDS_API_KEY && !oddsQuotaReady)) {
    errors.push(describeOddsQuotaFailure(oddsQuotaResult, process.env.ODDS_API_KEY));
  } else if (process.env.ODDS_API_KEY && oddsCreditsRemaining < 3) {
    errors.push(`The Odds API balance is ${oddsCreditsRemaining} credits; at least 3 are needed for current game lines.`);
  }
  const availableScoreboardEvents = new Map();
  let failedScoreboardDates = 0;
  scoreboardResults.forEach((result, index) => {
    if (result.status === "rejected") {
      failedScoreboardDates += 1;
      console.error(`Unable to load ${sport.label} scoreboard for ${scoreboardRequests[index].key}: ${result.reason.message}`);
      return;
    }
    for (const event of result.value.events ?? []) {
      availableScoreboardEvents.set(event.id, event);
    }
  });
  if (oddsResult.status === "rejected" && oddsQuotaReady) {
    errors.push("Live sportsbook odds are temporarily unavailable.");
  }

  const oddsEvents = oddsResult.status === "fulfilled"
    ? oddsResult.value ?? []
    : [];
  const scheduleEvents = eventScheduleResult.status === "fulfilled" &&
    eventScheduleResult.value?.length
    ? eventScheduleResult.value
    : oddsEvents;
  const supportedTeamIds = sport.teamIds ? new Set(sport.teamIds) : null;
  const allGames = [...availableScoreboardEvents.values()]
    .map(mapSportGame)
    .filter((game) =>
      game &&
      (!supportedTeamIds ||
        (supportedTeamIds.has(String(game.home?.id)) &&
          supportedTeamIds.has(String(game.away?.id)))),
    );
  const startTime = periodStart.getTime();
  const endTime = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000).getTime();
  const hasCurrentScoreboardGames = allGames.some((game) => {
    const date = new Date(game.date).getTime();
    return date >= startTime && date < endTime;
  });
  const existingMatchups = new Set(allGames.map((game) =>
    `${canonicalTeamName(game.home?.name)}:${canonicalTeamName(game.away?.name)}`,
  ));
  const fallbackGames = scheduleEvents
    .map(mapOddsScheduleGame)
    .filter((game) => game && new Date(game.date).getTime() >= startTime &&
      new Date(game.date).getTime() < endTime)
    .filter((game) => {
      const key = `${canonicalTeamName(game.home.name)}:${canonicalTeamName(game.away.name)}`;
      if (existingMatchups.has(key)) return false;
      existingMatchups.add(key);
      return true;
    });
  if (fallbackGames.length) {
    allGames.push(...fallbackGames);
    errors.push(`ESPN ${sport.label} schedule is incomplete; ${fallbackGames.length} upcoming game${fallbackGames.length === 1 ? " was" : "s were"} added from sportsbook fixtures. Results and stats still require ESPN.`);
  } else if (!hasCurrentScoreboardGames && failedScoreboardDates) {
    errors.push(`${sport.label} schedule and results are temporarily unavailable.`);
  }
  if (failedScoreboardDates && !fallbackGames.length) {
    errors.push(`${failedScoreboardDates} ESPN ${sport.label} game-date request${failedScoreboardDates === 1 ? " failed" : "s failed"}; some season records may be incomplete.`);
  }
  if (injuryResult.status === "rejected") {
    errors.push(`ESPN ${sport.label} injury reports are temporarily unavailable.`);
  }
  if (newsResult.status === "rejected") {
    errors.push(`ESPN ${sport.label} news is temporarily unavailable.`);
  }
  const injuryReport = injuryResult.status === "fulfilled"
    ? mapInjuryReport(injuryResult.value)
    : null;
  const news = newsResult.status === "fulfilled"
    ? mapLeagueNews(newsResult.value)
    : [];
  const games = allGames.filter((game) => {
    const date = new Date(game.date).getTime();
    return date >= startTime && date < endTime;
  });
  const seasonGames = allGames.filter((game) => {
    const date = new Date(game.date).getTime();
    return date >= seasonStart.getTime() && date < endTime;
  });
  const completedGames = new Map(
    seasonGames
      .filter((game) => game.completed)
      .map((game) => [game.id, game]),
  );
  const completedSeasonGames = seasonGames.filter((game) => game.completed);
  const summaryResults = await mapConcurrent(
    completedSeasonGames,
    6,
    (game) =>
      cachedFetch(
        `summary-${sport.id}-${season}-${game.id}`,
        `${espnBaseUrl}/summary?event=${encodeURIComponent(game.id)}`,
        {},
        ATS_CACHE_TTL_MS,
      ),
  );
  const summaries = new Map();
  let failedSummaryCount = 0;
  summaryResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      summaries.set(completedSeasonGames[index].id, result.value);
    } else {
      failedSummaryCount += 1;
    }
  });
  if (failedSummaryCount) {
    errors.push(`ESPN ${sport.label} game details are unavailable for ${failedSummaryCount} completed game${failedSummaryCount === 1 ? "" : "s"}; player stats and closing-line ATS records may be incomplete.`);
  }
  const atsRecords = buildAgainstTheSpreadRecords(completedSeasonGames, summaries);
  const keyPlayersByGame = new Map(
    completedSeasonGames.map((game) => [
      game.id,
      buildBasketballKeyPlayers(game, summaries.get(game.id)),
    ]),
  );
  for (const [id, game] of completedGames) {
    completedGames.set(id, {
      ...game,
      keyPlayers: keyPlayersByGame.get(id) ?? [],
    });
  }
  const trends = makeSportTeamTrends(seasonGames).map((team) => ({
    ...team,
    homeAts: atsRecords.get(team.id)?.home ?? null,
    awayAts: atsRecords.get(team.id)?.away ?? null,
  }));

  const settledSmartPicksChanged = settleSmartPickHistory(
    cache,
    `smart-picks-${sport.id}-`,
    completedGames.values(),
  );
  let settledPickChanged = false;
  for (const [key, entry] of cache) {
    if (!key.startsWith(`pick-of-week-${sport.id}-`) || !entry.value?.candidate) continue;
    const settled = settlePickOfWeekLock(
      entry.value,
      findGameForPick(entry.value.candidate, completedGames.values()),
    );
    if (settled !== entry.value) {
      cache.set(key, { ...entry, value: settled });
      settledPickChanged = true;
    }
  }
  if (settledPickChanged || settledSmartPicksChanged) void persistCache();

  const upcoming = games
    .filter((game) => !game.completed && new Date(game.date).getTime() >= Date.now())
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const odds = filterToSupportedSportsbooks(
    filterOddsToGames(oddsEvents, upcoming),
  );
  const analysis = analyzeOdds(odds, {
    trends,
    injuryReport,
    news,
    sportLabel: sport.label,
  });
  const week = Number(period.key);
  const pickLockKey = `pick-of-week-${sport.id}-${season}-${week}`;
  const savedPickLock = cache.get(pickLockKey)?.value ?? null;
  const pickLock = resolvePickOfWeekLock(analysis, savedPickLock);
  if (pickLock && !savedPickLock) {
    cache.set(pickLockKey, {
      value: {
        candidate: pickLock.candidate,
        selectedAt: pickLock.selectedAt,
        periodLabel: period.label,
      },
      savedAt: Date.now(),
    });
    void persistCache();
  }

  const smartPickKey = `smart-picks-${sport.id}-${season}-${week}`;
  const savedSmartPicks = cache.get(smartPickKey)?.value?.picks ?? [];
  const resolvedSmartPicks = resolveSmartPicks(analysis, savedSmartPicks);
  let smartPicks = alignSmartPicksWithPickOfWeek(
    resolvedSmartPicks,
    pickLock?.candidate,
  );
  let smartPicksChanged =
    smartPicks.length !== savedSmartPicks.length ||
    smartPicks.some((pick, index) => pick !== resolvedSmartPicks[index]);
  smartPicks = smartPicks.map((pick) => {
    const settled = settleSmartPick(
      pick,
      findGameForPick(pick.candidate, completedGames.values()),
    );
    if (settled !== pick) smartPicksChanged = true;
    return settled;
  });
  if (smartPicksChanged) {
    cache.set(smartPickKey, {
      value: { picks: smartPicks, periodLabel: period.label },
      savedAt: Date.now(),
    });
    void persistCache();
  }

  const pickOfWeekRecord = summarizePickOfWeekRecord(
    [...cache.entries()].flatMap(([key, entry]) => {
      const match = new RegExp(`^pick-of-week-${sport.id}-(\\d+)-(\\d+)$`).exec(key);
      return match && entry.value?.candidate
        ? [{
            season: Number(match[1]),
            week: Number(match[2]),
            periodLabel: entry.value.periodLabel,
            lock: entry.value,
          }]
        : [];
    }),
  );
  const smartPickRecord = summarizeSmartPickRecord(
    [...cache.entries()].flatMap(([key, entry]) => {
      const match = new RegExp(`^smart-picks-${sport.id}-(\\d+)-(\\d+)$`).exec(key);
      return match && Array.isArray(entry.value?.picks)
        ? [{
            season: Number(match[1]),
            week: Number(match[2]),
            periodLabel: entry.value.periodLabel,
            picks: entry.value.picks,
          }]
        : [];
    }),
  );
  const pickOfWeek = buildPickOfWeek({
    analysis,
    trends,
    injuryReport,
    week,
    periodLabel: period.label,
    news,
    candidate: pickLock?.candidate ?? null,
    selectedAt: pickLock?.selectedAt ?? null,
    priceUpdated: pickLock?.priceUpdated ?? false,
    sportLabel: sport.label,
    features: sport.features,
  });
  response.json({
    sport: sport.id,
    sportLabel: sport.label,
    features: sport.features,
    season,
    week,
    periodLabel: period.label,
    games: games.map((game) => ({
      ...game,
      keyPlayers: keyPlayersByGame.get(game.id) ?? [],
    })),
    trends,
    odds,
    analysis,
    playerProps: [],
    anytimeTouchdownParlays: [],
    pickOfWeek,
    pickOfWeekRecord,
    smartPicks,
    smartPickRecord,
    news,
    newsUpdatedAt: cache.get(`news-${sport.id}`)?.savedAt
      ? new Date(cache.get(`news-${sport.id}`).savedAt).toISOString()
      : null,
    atsGamesAvailable: Math.round(
      [...atsRecords.values()].reduce(
        (count, record) =>
          count +
          record.home.wins + record.home.losses + record.home.pushes +
          record.away.wins + record.away.losses + record.away.pushes,
        0,
      ) / 2,
    ),
    injuryReportUpdatedAt: injuryReport?.updatedAt ?? null,
    oddsConfigured: Boolean(process.env.ODDS_API_KEY),
    oddsUpdatedAt: cache.get(oddsCacheKey)?.savedAt
      ? new Date(cache.get(oddsCacheKey).savedAt).toISOString()
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
  console.log(`Vise API listening on http://localhost:${port}`);
});
