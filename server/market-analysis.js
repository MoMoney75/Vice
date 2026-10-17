import { findRelevantNews } from "./nfl-news.js";

const MARKET_LABELS = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};

function canonicalTeamName(name) {
  return name?.toLowerCase().replace(/[^a-z]/g, "");
}

export function filterOddsToGames(oddsEvents, games) {
  const matchups = new Set(
    games.map(
      (game) =>
        `${canonicalTeamName(game.home?.name)}:${canonicalTeamName(game.away?.name)}`,
    ),
  );
  return oddsEvents.filter((event) =>
    matchups.has(
      `${canonicalTeamName(event.home_team)}:${canonicalTeamName(event.away_team)}`,
    ),
  );
}

export function selectPickOfWeekCandidate(analysis) {
  return (analysis.pickCandidates ?? analysis.smartBets.map((game) => game.candidate))
    .filter((item) =>
      item &&
      (item.marketKey === "spreads" || item.marketKey === "totals") &&
      item.bookCount >= 2 &&
      Number.isFinite(item.fairProbability),
    )
    .sort((a, b) =>
      b.fairProbability - a.fairProbability ||
      b.bookCount - a.bookCount ||
      (b.fairProbabilitySourceCount ?? 0) - (a.fairProbabilitySourceCount ?? 0) ||
      (a.commenceTime ?? "").localeCompare(b.commenceTime ?? "") ||
      a.eventId.localeCompare(b.eventId) ||
      a.marketKey.localeCompare(b.marketKey) ||
      a.selection.localeCompare(b.selection),
    )[0] ?? null;
}

export function buildPickOfWeek({
  analysis,
  trends,
  injuryReport,
  week,
  news = [],
  candidate = selectPickOfWeekCandidate(analysis),
  selectedAt = null,
  priceUpdated = true,
}) {
  const trendByTeam = new Map(
    trends.map((team) => [canonicalTeamName(team.name), team]),
  );
  if (!candidate) return null;

  const getContext = (teamName, venue) => {
    const trend = trendByTeam.get(canonicalTeamName(teamName));
    const injury = injuryReport?.teams?.[canonicalTeamName(teamName)] ?? null;
    const gamesPlayed = trend ? trend.wins + trend.losses + trend.ties : 0;
    return {
      team: teamName,
      venue,
      form: trend
        ? {
            record: `${trend.wins}-${trend.losses}${trend.ties ? `-${trend.ties}` : ""}`,
            gamesPlayed,
            pointsForPerGame:
              gamesPlayed > 0 ? trend.pointsFor / gamesPlayed : null,
            pointsAgainstPerGame:
              gamesPlayed > 0 ? trend.pointsAgainst / gamesPlayed : null,
            pointDifferential: trend.pointDifferential,
            recent: trend.recent,
            recentGames: trend.recentGames ?? [],
          }
        : null,
      ats: trend?.[venue === "home" ? "homeAts" : "awayAts"] ?? null,
      injury: injury
        ? {
            reportedCount: injury.reportedCount,
            players: injury.players,
          }
        : null,
    };
  };

  const evidence = getPickEvidence(
    candidate,
    trendByTeam,
    injuryReport?.teams ?? {},
    injuryReport?.updatedAt ?? null,
    news,
  );

  return {
    week,
    selectedAt,
    priceUpdated,
    game: {
      eventId: candidate.eventId,
      eventName: candidate.eventName,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      commenceTime: candidate.commenceTime,
    },
    pick: {
      market: candidate.market,
      selection: candidate.selection,
      fairProbability: candidate.fairProbability,
      bestPrice: candidate.bestPrice,
      bestBookmaker: candidate.bestBookmaker,
      bookCount: candidate.bookCount,
    },
    context: {
      home: getContext(candidate.homeTeam, "home"),
      away: getContext(candidate.awayTeam, "away"),
    },
    reasoning: evidence.summary,
    news: evidence.news,
    injuryReportUpdatedAt: injuryReport?.updatedAt ?? null,
    basis:
      "Selected once per NFL week from spread and total lines priced by at least two sportsbooks. The highest no-vig market chance ranks first; ties favor broader book coverage, then a stable game and market order. The selection stays fixed for the week. Prices refresh only while the same line remains confirmed by two or more books. Form, injuries, and news are research context, not a validated prediction model or a guarantee.",
  };
}

function impliedProbability(price) {
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function decimalOdds(price) {
  if (!Number.isFinite(price) || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / -price;
}

function americanOdds(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : -Math.round(100 / (decimal - 1));
}

function formatRecentGames(trend) {
  return (trend?.recentGames ?? []).slice(0, 3).map((game) =>
    `${game.result} ${game.pointsFor}-${game.pointsAgainst} vs. ${game.opponent}`,
  );
}

function getPickEvidence(
  candidate,
  trendsByTeam,
  injuryTeams,
  injuryReportUpdatedAt,
  news = [],
) {
  const teams = [
    [candidate.awayTeam, "away"],
    [candidate.homeTeam, "home"],
  ].map(([teamName, venue]) => {
    const trend = trendsByTeam.get(canonicalTeamName(teamName));
    const injury = injuryTeams[canonicalTeamName(teamName)];
    const gamesPlayed = trend ? trend.wins + trend.losses + trend.ties : 0;
    const form = trend && gamesPlayed
      ? `${trend.wins}-${trend.losses}${trend.ties ? `-${trend.ties}` : ""}, ${trend.pointDifferential > 0 ? "+" : ""}${trend.pointDifferential} point differential`
      : "season form unavailable";
    const injuries = injury?.players?.slice(0, 2).map((item) =>
      `${item.player}${item.position ? ` (${item.position})` : ""}: ${item.status.toLowerCase()}`,
    ) ?? [];

    return {
      team: teamName,
      form,
      offensePointsPerGame:
        trend && gamesPlayed ? trend.pointsFor / gamesPlayed : null,
      defensePointsAllowedPerGame:
        trend && gamesPlayed ? trend.pointsAgainst / gamesPlayed : null,
      venue,
      ats: trend?.[venue === "home" ? "homeAts" : "awayAts"] ?? null,
      recentGames: formatRecentGames(trend),
      injuries,
      injuryReportAvailable: Boolean(injury),
    };
  });

  const relatedNews = findRelevantNews(
    news,
    [candidate.awayTeam, candidate.homeTeam],
    [],
    3,
  );
  const teamNarratives = teams.map((team) => {
    if (team.offensePointsPerGame === null) {
      return `${team.team}'s current-season scoring data is unavailable.`;
    }
    const offense = team.offensePointsPerGame.toFixed(1);
    const defense = team.defensePointsAllowedPerGame.toFixed(1);
    const recent = team.recentGames.length
      ? ` Recent results: ${team.recentGames.join("; ")}.`
      : "";
    return `${team.team} are ${team.form.split(",")[0]}, scoring ${offense} points per game and allowing ${defense}.${recent}`;
  });
  const newsNarrative = relatedNews.length
    ? ` Recent ESPN coverage: ${relatedNews.map((article) => article.headline).join(" ")}`
    : " No directly related headline appeared in ESPN's latest NFL feed.";
  const injuryNotes = teams.flatMap((team) =>
    team.injuries.map((item) => `${team.team}: ${item}`),
  );
  const injuryNarrative = injuryNotes.length
    ? ` ESPN's latest injury summary lists ${injuryNotes.join("; ")}.`
    : teams.every((team) => team.injuryReportAvailable)
      ? " ESPN's team injury summaries have no key non-active listings to highlight."
      : " Current injury-report data is unavailable.";

  return {
    market: `${candidate.bookCount} sportsbooks compared; best price ${candidate.bestPrice > 0 ? "+" : ""}${candidate.bestPrice} at ${candidate.bestBookmaker}, versus a ${Math.round(candidate.fairProbability * 1000) / 10}% no-vig market consensus.`,
    teams,
    news: relatedNews,
    summary:
      `${candidate.selection} is priced at ${candidate.bestPrice > 0 ? "+" : ""}${candidate.bestPrice} by ${candidate.bestBookmaker}. Across ${candidate.bookCount} books, the no-vig market estimate is ${Math.round(candidate.fairProbability * 1000) / 10}%. ` +
      `${teamNarratives.join(" ")}${injuryNarrative}${newsNarrative} These season results and reports are context, not a standalone prediction.`,
    injuryReportUpdatedAt,
  };
}

function quoteGroup(marketKey, bookmaker, event) {
  const outcomes = bookmaker.markets?.find((market) => market.key === marketKey)?.outcomes ?? [];
  const getOutcome = (name) => outcomes.find((outcome) => outcome.name === name);

  if (marketKey === "h2h") {
    const home = getOutcome(event.home_team);
    const away = getOutcome(event.away_team);
    return validPair(home, away) ? { line: null, home, away } : null;
  }

  if (marketKey === "spreads") {
    const home = getOutcome(event.home_team);
    const away = getOutcome(event.away_team);
    if (
      !validPair(home, away) ||
      !Number.isFinite(home.point) ||
      !Number.isFinite(away.point) ||
      Math.abs(home.point + away.point) > 0.01
    ) return null;
    return { line: home.point, home, away };
  }

  const over = getOutcome("Over");
  const under = getOutcome("Under");
  if (
    !validPair(over, under) ||
    !Number.isFinite(over.point) ||
    over.point !== under.point
  ) return null;
  return { line: over.point, home: over, away: under };
}

function validPair(first, second) {
  return (
    first &&
    second &&
    impliedProbability(first.price) !== null &&
    impliedProbability(second.price) !== null
  );
}

function describeSelection(marketKey, outcome, line) {
  if (marketKey === "h2h") return `${outcome.name} to win`;
  if (marketKey === "totals") return `${outcome.name} ${line}`;
  return `${outcome.name} ${line > 0 ? "+" : ""}${line}`;
}

function collectCandidates(event) {
  const groups = new Map();
  for (const marketKey of Object.keys(MARKET_LABELS)) {
    for (const bookmaker of event.bookmakers ?? []) {
      const pair = quoteGroup(marketKey, bookmaker, event);
      if (!pair) continue;
      const homeProbability = impliedProbability(pair.home.price);
      const awayProbability = impliedProbability(pair.away.price);
      const total = homeProbability + awayProbability;
      const outcomes = [
        { outcome: pair.home, fairProbability: homeProbability / total },
        { outcome: pair.away, fairProbability: awayProbability / total },
      ];

      for (const { outcome, fairProbability } of outcomes) {
        const selectionLine =
          marketKey === "spreads" ? outcome.point : pair.line;
        const lineKey = selectionLine === null ? "" : String(selectionLine);
        const groupKey = `${marketKey}:${lineKey}`;
        const candidateKey = `${groupKey}:${outcome.name}`;
        const candidate = groups.get(candidateKey) ?? {
          eventId: event.id,
          eventName: event.name ?? `${event.away_team} at ${event.home_team}`,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime: event.commence_time,
          marketKey,
          market: MARKET_LABELS[marketKey],
          outcomeName: outcome.name,
          selection: describeSelection(marketKey, outcome, selectionLine),
          line: selectionLine,
          consensusProbabilities: [],
          bookmakerQuotes: [],
        };
        candidate.consensusProbabilities.push(fairProbability);
        candidate.bookmakerQuotes.push({
          bookmaker: bookmaker.title,
          price: outcome.price,
          impliedProbability: impliedProbability(outcome.price),
        });
        groups.set(candidateKey, candidate);
      }
    }
  }

  return [...groups.values()]
    .filter((candidate) => new Set(candidate.bookmakerQuotes.map((quote) => quote.bookmaker)).size >= 2)
    .map((candidate) => {
      const fairProbability =
        candidate.consensusProbabilities.reduce((sum, value) => sum + value, 0) /
        candidate.consensusProbabilities.length;
      const bestQuote = candidate.bookmakerQuotes.reduce((best, quote) => {
        const currentDecimal = decimalOdds(quote.price);
        return currentDecimal > decimalOdds(best.price) ? quote : best;
      });
      const bestDecimalOdds = decimalOdds(bestQuote.price);
      return {
        eventId: candidate.eventId,
        eventName: candidate.eventName,
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        commenceTime: candidate.commenceTime,
        marketKey: candidate.marketKey,
        market: candidate.market,
        selection: candidate.selection,
        line: candidate.line,
        fairProbability,
        fairProbabilitySourceCount: candidate.consensusProbabilities.length,
        bestPrice: bestQuote.price,
        bestBookmaker: bestQuote.bookmaker,
        bookCount: new Set(candidate.bookmakerQuotes.map((quote) => quote.bookmaker)).size,
        breakEvenProbability: impliedProbability(bestQuote.price),
        consensusEdge: fairProbability - impliedProbability(bestQuote.price),
        expectedValue: fairProbability * bestDecimalOdds - 1,
        bookmakerQuotes: candidate.bookmakerQuotes,
      };
    });
}

function makeParlay(legs, bookmaker, tier) {
  const combinedDecimalOdds = legs.reduce(
    (product, leg) => product * decimalOdds(leg.price),
    1,
  );
  const estimatedProbability = legs.reduce(
    (product, leg) => product * leg.fairProbability,
    1,
  );
  return {
    tier,
    legCount: legs.length,
    legs: [...legs],
    bookmaker,
    combinedAmericanOdds: americanOdds(combinedDecimalOdds),
    estimatedProbability,
    estimatedDecimalOdds: 1 / estimatedProbability,
  };
}

function collectParlayCandidates(candidates) {
  const byBookmaker = new Map();
  for (const candidate of candidates) {
    for (const quote of candidate.bookmakerQuotes) {
      const events = byBookmaker.get(quote.bookmaker) ?? new Map();
      const selections = events.get(candidate.eventId) ?? [];
      const leg = {
        eventId: candidate.eventId,
        eventName: candidate.eventName,
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        commenceTime: candidate.commenceTime,
        market: candidate.market,
        marketKey: candidate.marketKey,
        selection: candidate.selection,
        fairProbability: candidate.fairProbability,
        price: quote.price,
      };
      selections.push(leg);
      events.set(candidate.eventId, selections);
      byBookmaker.set(quote.bookmaker, events);
    }
  }
  return byBookmaker;
}

function buildCombinations(bookmaker, eventOptions, tier, options = {}) {
  const result = [];
  for (const legCount of [2, 3]) {
    const pick = (eventIndex, legs, hasNonMoneyline) => {
      if (legs.length === legCount) {
        if (options.requireNonMoneyline && !hasNonMoneyline) return;
        result.push(makeParlay(legs, bookmaker, tier));
        return;
      }
      if (eventIndex >= eventOptions.length) return;
      if (legs.length + eventOptions.length - eventIndex < legCount) return;

      pick(eventIndex + 1, legs, hasNonMoneyline);
      for (const leg of eventOptions[eventIndex]) {
        legs.push(leg);
        pick(
          eventIndex + 1,
          legs,
          hasNonMoneyline || leg.marketKey !== "h2h",
        );
        legs.pop();
      }
    };
    pick(0, [], false);
  }
  return result;
}

function dedupeAndRank(parlays, sortBy, includeMarketDiversity = false) {
  const unique = new Map();
  for (const parlay of parlays) {
    const key = `${parlay.tier}:${parlay.legs
      .map((leg) => `${leg.eventId}:${leg.selection}`)
      .sort()
      .join("|")}`;
    const previous = unique.get(key);
    if (
      !previous ||
      decimalOdds(parlay.combinedAmericanOdds) >
        decimalOdds(previous.combinedAmericanOdds)
    ) unique.set(key, parlay);
  }
  return [2, 3].flatMap((legCount) => {
    const ranked = [...unique.values()]
      .filter((parlay) => parlay.legCount === legCount)
      .sort((a, b) => b[sortBy] - a[sortBy]);
    const selected = [];
    const isDiverse = (parlay) => {
      const picks = new Set(parlay.legs.map((leg) => `${leg.eventId}:${leg.selection}`));
      const maxOverlap = legCount - 2;
      const overlaps = selected.some((existing) => {
        const existingPicks = new Set(
          existing.legs.map((leg) => `${leg.eventId}:${leg.selection}`),
        );
        let shared = 0;
        for (const pick of picks) if (existingPicks.has(pick)) shared += 1;
        return shared > maxOverlap;
      });
      return !overlaps && !selected.includes(parlay);
    };

    if (includeMarketDiversity) {
      for (const marketKey of ["spreads", "totals"]) {
        const marketParlay = ranked.find((parlay) =>
          parlay.legs.some((leg) => leg.marketKey === marketKey) &&
          isDiverse(parlay),
        );
        if (marketParlay) selected.push(marketParlay);
      }
    }
    for (const parlay of ranked) {
      if (isDiverse(parlay)) selected.push(parlay);
      if (selected.length === 3) break;
    }
    return selected;
  });
}

function createParlays(candidates) {
  const parlayCandidates = collectParlayCandidates(candidates);
  const higherHitRate = [];
  const higherPayout = [];

  for (const [bookmaker, eventMap] of parlayCandidates) {
    const events = [...eventMap.values()];
    const hitRateOptions = events
      .map((selections) => [
        selections.reduce((best, leg) =>
          leg.fairProbability > best.fairProbability ? leg : best,
        ),
      ])
      .sort((a, b) => b[0].fairProbability - a[0].fairProbability);
    higherHitRate.push(
      ...buildCombinations(bookmaker, hitRateOptions, "higher-hit-rate"),
    );

    const returnOptions = ["h2h", "spreads", "totals"].map((marketKey) =>
      events
        .filter((selections) =>
          selections.some((leg) => leg.marketKey === marketKey),
        )
        .map((selections) =>
          selections
            .filter((leg) => leg.marketKey === marketKey)
            .reduce((best, leg) =>
              !best || decimalOdds(leg.price) > decimalOdds(best.price)
                ? leg
                : best,
            ),
        )
        .filter(Boolean)
        .sort((a, b) => decimalOdds(b.price) - decimalOdds(a.price))
        .slice(0, 6),
    );
    const eventOptions = new Map();
    for (const marketOptions of returnOptions) {
      for (const leg of marketOptions) {
        const selections = eventOptions.get(leg.eventId) ?? [];
        selections.push(leg);
        eventOptions.set(leg.eventId, selections);
      }
    }
    const boundedReturnOptions = [...eventOptions.values()].sort((a, b) => {
      const bestOdds = (options) => Math.max(...options.map((leg) => decimalOdds(leg.price)));
      return bestOdds(b) - bestOdds(a);
    }).slice(0, 18);
    higherPayout.push(
      ...buildCombinations(bookmaker, boundedReturnOptions, "higher-payout", {
        requireNonMoneyline: true,
      }),
    );
  }

  return [
    ...dedupeAndRank(higherHitRate, "estimatedProbability"),
    ...dedupeAndRank(higherPayout, "combinedAmericanOdds", true),
  ];
}

export function analyzeOdds(
  oddsEvents,
  { trends = [], injuryReport = null, news = [] } = {},
) {
  const smartBets = [];
  const candidates = [];
  const trendsByTeam = new Map(
    trends.map((team) => [canonicalTeamName(team.name), team]),
  );
  const injuryTeams = injuryReport?.teams ?? {};

  for (const event of oddsEvents) {
    const eventCandidates = collectCandidates(event);
    candidates.push(...eventCandidates);
    if (eventCandidates.length === 0) {
      smartBets.push({
        eventId: event.id,
        eventName: event.name ?? `${event.away_team} at ${event.home_team}`,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: event.commence_time,
        candidate: null,
      });
      continue;
    }

    const candidate = eventCandidates.reduce((best, current) =>
      current.expectedValue > best.expectedValue ? current : best,
    );
    const { bookmakerQuotes: _bookmakerQuotes, ...displayCandidate } = candidate;
    smartBets.push({
      eventId: event.id,
      eventName: event.name ?? `${event.away_team} at ${event.home_team}`,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
      candidate: displayCandidate,
      positiveConsensusEdge: candidate.expectedValue > 0,
      evidence: getPickEvidence(
        candidate,
        trendsByTeam,
        injuryTeams,
        injuryReport?.updatedAt ?? null,
        news,
      ),
    });
  }

  return {
    smartBets,
    pickCandidates: candidates
      .filter((candidate) => candidate.marketKey === "spreads" || candidate.marketKey === "totals")
      .map(({ bookmakerQuotes: _bookmakerQuotes, ...candidate }) => candidate),
    parlays: createParlays(candidates),
  };
}
