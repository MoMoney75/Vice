import { findRelevantNews } from "./nfl-news.js";

const PROP_MARKETS = {
  player_anytime_td: {
    label: "Anytime touchdown",
    stats: ["rushingTouchdowns", "receivingTouchdowns"],
  },
  player_pass_yds: {
    label: "Passing yards",
    stats: ["passingYards"],
  },
  player_rush_yds: {
    label: "Rushing yards",
    stats: ["rushingYards"],
  },
  player_receptions: {
    label: "Receptions",
    stats: ["receptions"],
  },
  player_reception_yds: {
    label: "Receiving yards",
    stats: ["receivingYards"],
  },
};

const STAT_LABELS = {
  passingYards: "Passing yards",
  rushingYards: "Rushing yards",
  receivingYards: "Receiving yards",
  receptions: "Receptions",
  rushingTouchdowns: "Rushing TDs",
  receivingTouchdowns: "Receiving TDs",
};

function canonical(value) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
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

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function makeStatsLookup(statistics) {
  const stats = new Map();
  const categoryNames = Object.keys(STAT_LABELS);
  for (const category of statistics?.stats?.categories ?? []) {
    if (!categoryNames.includes(category.name)) continue;
    category.leaders?.forEach((leader, index) => {
      const name = leader.athlete?.displayName;
      if (!name || !Number.isFinite(leader.value)) return;
      const key = canonical(name);
      const player = stats.get(key) ?? { player: name, team: leader.team?.displayName ?? null, categories: {} };
      player.categories[category.name] = {
        value: leader.value,
        rank: index + 1,
      };
      if (!player.team && leader.team?.displayName) player.team = leader.team.displayName;
      stats.set(key, player);
    });
  }
  return stats;
}

function outcomeQuotes(event, marketKey) {
  const quotes = new Map();
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((item) => item.key === marketKey);
    for (const outcome of market?.outcomes ?? []) {
      const player = outcome.description?.trim();
      const probability = impliedProbability(outcome.price);
      if (!player || probability === null) continue;
      const line = Number.isFinite(outcome.point) ? outcome.point : null;
      const key = `${canonical(player)}:${line ?? ""}`;
      const playerQuotes = quotes.get(key) ?? {
        player,
        line,
        bookmakers: new Map(),
      };
      const sides = playerQuotes.bookmakers.get(bookmaker.title) ?? new Map();
      sides.set(outcome.name, {
        price: outcome.price,
        impliedProbability: probability,
      });
      playerQuotes.bookmakers.set(bookmaker.title, sides);
      quotes.set(key, playerQuotes);
    }
  }
  return quotes;
}

function makeMarketCandidates(event, marketKey) {
  const marketConfig = PROP_MARKETS[marketKey];
  const groups = outcomeQuotes(event, marketKey);
  const candidates = [];

  for (const group of groups.values()) {
    if (marketKey === "player_anytime_td") {
      const quotes = [];
      for (const [bookmaker, sides] of group.bookmakers) {
        const yes = sides.get("Yes");
        if (yes) quotes.push({ bookmaker, ...yes });
      }
      if (!quotes.length) continue;
      const probability =
        quotes.reduce((sum, quote) => sum + quote.impliedProbability, 0) / quotes.length;
      candidates.push({
        eventId: event.id,
        eventName: event.name ?? `${event.away_team} at ${event.home_team}`,
        commenceTime: event.commence_time,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        player: group.player,
        playerTeam: null,
        marketKey,
        market: marketConfig.label,
        selection: "Anytime TD scorer",
        line: null,
        fairProbability: probability,
        probabilitySource: quotes.length > 1
          ? "raw implied probability"
          : "single-book implied probability",
        bookmakerQuotes: quotes,
      });
      continue;
    }

    const pairedQuotes = [];
    for (const [bookmaker, sides] of group.bookmakers) {
      const over = sides.get("Over");
      const under = sides.get("Under");
      if (!over || !under) continue;
      const total = over.impliedProbability + under.impliedProbability;
      pairedQuotes.push({
        bookmaker,
        over: over.price,
        under: under.price,
        overProbability: over.impliedProbability / total,
        underProbability: under.impliedProbability / total,
      });
    }
    if (!pairedQuotes.length) continue;

    for (const side of ["Over", "Under"]) {
      const probabilityKey = `${side.toLowerCase()}Probability`;
      const priceKey = side.toLowerCase();
      candidates.push({
        eventId: event.id,
        eventName: event.name ?? `${event.away_team} at ${event.home_team}`,
        commenceTime: event.commence_time,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        player: group.player,
        playerTeam: null,
        marketKey,
        market: marketConfig.label,
        selection: `${side} ${group.line}`,
        line: group.line,
        fairProbability:
          pairedQuotes.reduce((sum, quote) => sum + quote[probabilityKey], 0) /
          pairedQuotes.length,
        probabilitySource: pairedQuotes.length > 1
          ? "no-vig consensus"
          : "single-book no-vig probability",
        bookmakerQuotes: pairedQuotes.map((quote) => ({
          bookmaker: quote.bookmaker,
          price: quote[priceKey],
        })),
      });
    }
  }
  return candidates;
}

function findPlayerInjury(playerName, injuryReport) {
  const playerInjury = injuryReport?.playerStatuses?.[canonical(playerName)];
  if (playerInjury) return playerInjury;

  for (const [teamKey, team] of Object.entries(injuryReport?.teams ?? {})) {
    const match = team.players?.find((item) => canonical(item.player) === canonical(playerName));
    if (match) return { ...match, team: team.team, teamKey };
  }
  return null;
}

function makeEvidence(
  candidate,
  statsByPlayer,
  trendsByTeam,
  defensiveStatsByTeam,
  injuryReport,
  news,
  playerRosters,
) {
  const playerStats = statsByPlayer.get(canonical(candidate.player));
  const roster = playerRosters.get(canonical(candidate.player));
  const playerTeam =
    playerStats?.team ?? roster?.team ?? findPlayerInjury(candidate.player, injuryReport)?.team ?? null;
  const candidateWithTeam = {
    ...candidate,
    playerTeam,
    playerPosition: roster?.position ?? null,
  };
  const homeKey = canonical(candidate.homeTeam);
  const awayKey = canonical(candidate.awayTeam);
  const teamKey = canonical(playerTeam);
  const opponentName =
    teamKey === homeKey ? candidate.awayTeam : teamKey === awayKey ? candidate.homeTeam : null;
  const opponent = opponentName ? trendsByTeam.get(canonical(opponentName)) : null;
  const opponentPropStats = opponentName
    ? defensiveStatsByTeam.get(canonical(opponentName))?.[candidate.marketKey] ?? null
    : null;
  const playerTeamTrend = playerTeam ? trendsByTeam.get(canonical(playerTeam)) : null;
  const opponentGames = opponent
    ? opponent.wins + opponent.losses + opponent.ties
    : 0;
  const playerTeamGames = playerTeamTrend
    ? playerTeamTrend.wins + playerTeamTrend.losses + playerTeamTrend.ties
    : 0;
  const injury = findPlayerInjury(candidate.player, injuryReport);
  const stats = PROP_MARKETS[candidate.marketKey].stats
    .map((key) => {
      const value = playerStats?.categories?.[key];
      return value
        ? { label: STAT_LABELS[key], value: value.value, rank: value.rank }
        : null;
    })
    .filter(Boolean);
  const recentTeamGames = (playerTeamTrend?.recentGames ?? []).slice(0, 3).map((game) =>
    `${game.result} ${game.pointsFor}-${game.pointsAgainst} vs. ${game.opponent}`,
  );
  const relatedNews = findRelevantNews(
    news,
    [playerTeam, opponentName],
    [candidate.player],
    3,
  );
  const seasonProduction = stats.length
    ? stats.map((stat) =>
        `${candidate.player} recorded ${stat.value} ${stat.label.toLowerCase()} this season${stat.rank ? ` (ranked #${stat.rank} on ESPN's leaderboard)` : ""}`,
      ).join("; ")
    : `ESPN's current-season leaderboard does not list a total for ${candidate.player}'s ${candidate.market.toLowerCase()}`;
  const offenseContext =
    playerTeamTrend && playerTeamGames
      ? `${playerTeam} have scored ${(
          playerTeamTrend.pointsFor / playerTeamGames
        ).toFixed(1)} points per game this season`
      : `${playerTeam ?? "The player's team"}'s current-season scoring trend is unavailable`;
  const defenseContext =
    opponent && opponentGames
      ? `${opponentName}'s defense has allowed ${(
          opponent.pointsAgainst / opponentGames
        ).toFixed(1)} points per game`
      : `${opponentName ?? "The opponent"}'s current-season defensive trend is unavailable`;
  const propDefenseContext = opponentPropStats
    ? `${opponentName} has allowed ${opponentPropStats.stats
        .map((stat) => `${stat.total} ${stat.label.toLowerCase()} in ${stat.games} games (${stat.perGame.toFixed(1)} per game)`)
        .join(" and ")}; that ranks #${opponentPropStats.rank} of ${opponentPropStats.teamsRanked} defenses (fewest allowed) for ${candidate.market.toLowerCase()}`
    : `${opponentName ?? "The opponent"}'s season-to-date ${candidate.market.toLowerCase()} defense stats are unavailable`;
  const newsContext = relatedNews.length
    ? `Recent ESPN coverage: ${relatedNews.map((article) => article.headline).join(" ")}`
    : "No directly related headline appeared in ESPN's latest NFL feed.";
  const injuryContext = injury
    ? `ESPN lists ${candidate.player} as ${injury.status.toLowerCase()}${injury.detail ? ` (${injury.detail})` : ""}.`
    : injuryReport?.updatedAt
      ? `No non-active injury listing for ${candidate.player} appeared in the latest ESPN report.`
      : "The latest injury report is unavailable.";

  return {
    candidate: candidateWithTeam,
    evidence: {
      market: `${candidate.bookmakerCount} sportsbook${candidate.bookmakerCount === 1 ? "" : "s"} ${candidate.bookmakerCount === 1 ? "listed" : "compared"}; ${candidate.probabilitySource} is ${Math.round(candidate.fairProbability * 1000) / 10}%. Best listed price: ${candidate.bestPrice > 0 ? "+" : ""}${candidate.bestPrice} at ${candidate.bestBookmaker}.`,
      seasonStats: stats,
      seasonStatsAvailable: Boolean(stats.length),
      opponent: opponentName
        ? {
            team: opponentName,
            record: opponent
              ? `${opponent.wins}-${opponent.losses}${opponent.ties ? `-${opponent.ties}` : ""}`
              : null,
            pointsAllowedPerGame:
              opponent && opponentGames
                ? Math.round((opponent.pointsAgainst / opponentGames) * 10) / 10
                : null,
          }
        : null,
      opponentPropStats: opponentPropStats
        ? {
            team: opponentName,
            rank: opponentPropStats.rank,
            teamsRanked: opponentPropStats.teamsRanked,
            games: opponentPropStats.games,
            stats: opponentPropStats.stats,
          }
        : null,
      offense: playerTeamTrend && playerTeamGames
        ? {
            team: playerTeam,
            record: `${playerTeamTrend.wins}-${playerTeamTrend.losses}${playerTeamTrend.ties ? `-${playerTeamTrend.ties}` : ""}`,
            pointsPerGame: Math.round((playerTeamTrend.pointsFor / playerTeamGames) * 10) / 10,
            recentGames: recentTeamGames,
          }
        : null,
      injury: injury
        ? {
            player: injury.player,
            position: injury.position ?? null,
            status: injury.status,
            detail: injury.detail ?? null,
            team: injury.team ?? playerTeam,
          }
        : null,
      injuryReportAvailable: Boolean(injuryReport?.updatedAt),
      seasonStatsNote:
        "ESPN player leaderboard totals are cumulative for the season, not per-game projections.",
      injuryReportUpdatedAt: injuryReport?.updatedAt ?? null,
      news: relatedNews,
      summary:
        `${candidate.player}'s ${candidate.market.toLowerCase()} ${candidate.selection.toLowerCase()} is priced at ${candidate.bestPrice > 0 ? "+" : ""}${candidate.bestPrice} by ${candidate.bestBookmaker}. ` +
        `${candidate.bookmakerCount} books put the ${candidate.probabilitySource} at ${Math.round(candidate.fairProbability * 1000) / 10}%. ` +
        `${seasonProduction}. ${offenseContext}; ${defenseContext}. ${propDefenseContext}. ` +
        `${recentTeamGames.length ? `Recent ${playerTeam} results: ${recentTeamGames.join("; ")}. ` : ""}` +
        `${injuryContext} ${newsContext} These are season-to-date research notes, not a player projection.`,
    },
  };
}

export function analyzePlayerProps(
  propEvents,
  {
    statistics = null,
    trends = [],
    defensiveStatsByTeam = new Map(),
    injuryReport = null,
    news = [],
    playerRosters = new Map(),
  } = {},
) {
  const statsByPlayer = makeStatsLookup(statistics);
  const trendsByTeam = new Map(trends.map((team) => [canonical(team.name), team]));
  const defensesByTeam = new Map(
    [...defensiveStatsByTeam].map(([team, stats]) => [canonical(team), stats]),
  );
  const candidates = [];

  for (const event of propEvents) {
    for (const marketKey of Object.keys(PROP_MARKETS)) {
      candidates.push(...makeMarketCandidates(event, marketKey));
    }
  }

  const byPlayerAndMarket = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.eventId}:${canonical(candidate.player)}:${candidate.marketKey}`;
    const options = byPlayerAndMarket.get(key) ?? [];
    options.push(candidate);
    byPlayerAndMarket.set(key, options);
  }

  return [...byPlayerAndMarket.values()]
    .map((options) => {
      const selected = options.reduce((best, current) => {
        const currentBooks = new Set(current.bookmakerQuotes.map((quote) => quote.bookmaker)).size;
        const bestBooks = new Set(best.bookmakerQuotes.map((quote) => quote.bookmaker)).size;
        const currentBestPrice = Math.max(...current.bookmakerQuotes.map((quote) => quote.price));
        const bestBestPrice = Math.max(...best.bookmakerQuotes.map((quote) => quote.price));
        const currentValue = current.fairProbability * decimalOdds(currentBestPrice);
        const bestValue = best.fairProbability * decimalOdds(bestBestPrice);
        if (currentValue !== bestValue) return currentValue > bestValue ? current : best;
        return currentBooks > bestBooks ? current : best;
      });
      const bestQuote = selected.bookmakerQuotes.reduce((best, quote) =>
        decimalOdds(quote.price) > decimalOdds(best.price) ? quote : best,
      );
      const bookmakerCount = new Set(selected.bookmakerQuotes.map((quote) => quote.bookmaker)).size;
      return makeEvidence({
        ...selected,
        bestPrice: bestQuote.price,
        bestBookmaker: bestQuote.bookmaker,
        bookmakerCount,
        breakEvenProbability: impliedProbability(bestQuote.price),
        expectedValue: selected.fairProbability * decimalOdds(bestQuote.price) - 1,
      }, statsByPlayer, trendsByTeam, defensesByTeam, injuryReport, news, playerRosters);
    })
    .sort((a, b) => b.candidate.expectedValue - a.candidate.expectedValue);
}

export function buildAnytimeTouchdownParlays(
  playerProps,
  { trends = [], maxPerLegCount = 3 } = {},
) {
  const trendsByTeam = new Map(trends.map((team) => [canonical(team.name), team]));
  const teamScoringRates = trends
    .map((team) => {
      const games = team.wins + team.losses + team.ties;
      return games ? team.pointsFor / games : null;
    })
    .filter(Number.isFinite);
  const leagueScoringAverage = teamScoringRates.length
    ? teamScoringRates.reduce((sum, rate) => sum + rate, 0) / teamScoringRates.length
    : null;
  const byBookmaker = new Map();

  for (const pick of playerProps) {
    const { candidate, evidence } = pick;
    if (candidate.marketKey !== "player_anytime_td" || !candidate.playerTeam) continue;
    if (
      evidence.injury &&
      ["out", "doubtful", "injured reserve", "physically unable to perform", "pup"].includes(
        evidence.injury.status.toLowerCase(),
      )
    ) continue;

    const playerTeam = trendsByTeam.get(canonical(candidate.playerTeam));
    const opponentName =
      canonical(candidate.playerTeam) === canonical(candidate.homeTeam)
        ? candidate.awayTeam
        : canonical(candidate.playerTeam) === canonical(candidate.awayTeam)
          ? candidate.homeTeam
          : null;
    const opponent = opponentName ? trendsByTeam.get(canonical(opponentName)) : null;
    const playerGames = playerTeam
      ? playerTeam.wins + playerTeam.losses + playerTeam.ties
      : 0;
    const opponentGames = opponent
      ? opponent.wins + opponent.losses + opponent.ties
      : 0;
    if (!playerGames || !opponentGames || !leagueScoringAverage) continue;

    const pointsPerGame = playerTeam.pointsFor / playerGames;
    const opponentPointsAllowedPerGame = opponent.pointsAgainst / opponentGames;
    const trendFactor = Math.max(
      0.8,
      Math.min(
        1.2,
        1 +
          0.2 * (pointsPerGame - leagueScoringAverage) / leagueScoringAverage +
          0.2 * (opponentPointsAllowedPerGame - leagueScoringAverage) / leagueScoringAverage,
      ),
    );
    const quotes = candidate.bookmakerQuotes.filter(
      (quote) => quote.bookmaker && Number.isFinite(quote.price) && quote.price !== 0,
    );
    if (!quotes.length) continue;
    const marketProbability = median(
      quotes
        .map((quote) => quote.impliedProbability)
        .filter((probability) => Number.isFinite(probability) && probability > 0),
    );
    if (!Number.isFinite(marketProbability)) continue;

    for (const quote of quotes) {
      const bookmakers = byBookmaker.get(quote.bookmaker) ?? new Map();
      const gameLegs = bookmakers.get(candidate.eventId) ?? [];
      gameLegs.push({
        eventId: candidate.eventId,
        eventName: candidate.eventName,
        commenceTime: candidate.commenceTime,
        player: candidate.player,
        playerTeam: candidate.playerTeam,
        opponent: opponentName,
        selection: candidate.selection,
        marketPrice: quote.price,
        marketProbability,
        pointsPerGame,
        opponentPointsAllowedPerGame,
        trendFactor,
        researchScore: marketProbability * trendFactor,
        opponentPropStats: evidence.opponentPropStats,
        injury: evidence.injury,
      });
      bookmakers.set(candidate.eventId, gameLegs);
      byBookmaker.set(quote.bookmaker, bookmakers);
    }
  }

  const parlaysByKey = new Map();
  for (const [bookmaker, eventMap] of byBookmaker) {
    const games = [...eventMap.entries()]
      .map(([eventId, legs]) => {
        const byTeam = new Map();
        for (const leg of legs.sort((a, b) => b.researchScore - a.researchScore)) {
          const teamLegs = byTeam.get(leg.playerTeam) ?? [];
          if (teamLegs.length < 2) teamLegs.push(leg);
          byTeam.set(leg.playerTeam, teamLegs);
        }
        return { eventId, legs: [...byTeam.values()].flat() };
      })
      .filter((game) => game.legs.length);

    for (const legCount of [2, 3]) {
      const chosenGames = [];
      const collect = (startIndex) => {
        if (chosenGames.length === legCount) {
          const combinations = [];
          const chooseLegs = (gameIndex, legs) => {
            if (gameIndex === chosenGames.length) {
              combinations.push(legs);
              return;
            }
            for (const leg of chosenGames[gameIndex].legs) {
              chooseLegs(gameIndex + 1, [...legs, leg]);
            }
          };
          chooseLegs(0, []);
          for (const legs of combinations) {
            const combinedDecimalOdds = legs.reduce(
              (product, leg) => product * decimalOdds(leg.marketPrice),
              1,
            );
            const parlay = {
              legCount,
              bookmaker,
              legs,
              estimatedProbability: legs.reduce(
                (product, leg) => product * leg.marketProbability,
                1,
              ),
              combinedDecimalOdds,
              combinedAmericanOdds: americanOdds(combinedDecimalOdds),
              researchScore: legs.reduce(
                (product, leg) => product * leg.researchScore,
                1,
              ) ** (1 / legCount),
            };
            const key = legs
              .map((leg) => `${leg.eventId}:${canonical(leg.player)}`)
              .sort()
              .join("|");
            const previous = parlaysByKey.get(key);
            if (
              !previous ||
              parlay.combinedDecimalOdds > previous.combinedDecimalOdds
            ) parlaysByKey.set(key, parlay);
          }
          return;
        }

        for (let index = startIndex; index <= games.length - (legCount - chosenGames.length); index += 1) {
          chosenGames.push(games[index]);
          collect(index + 1);
          chosenGames.pop();
        }
      };
      collect(0);
    }
  }

  return [2, 3].flatMap((legCount) =>
    [...parlaysByKey.values()]
      .filter((parlay) => parlay.legCount === legCount)
      .sort((a, b) =>
        b.researchScore - a.researchScore ||
        b.estimatedProbability - a.estimatedProbability,
      )
      .slice(0, maxPerLegCount),
  );
}

export { PROP_MARKETS };
