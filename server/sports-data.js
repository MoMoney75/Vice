export function mapSportGame(event) {
  const competition = event.competitions?.[0];
  if (!competition) return null;
  const competitors = competition.competitors ?? [];
  const status = competition.status ?? event.status;
  const getTeam = (homeAway) => {
    const competitor = competitors.find((item) => item.homeAway === homeAway);
    return competitor
      ? {
          id: competitor.team.id,
          name: competitor.team.displayName,
          abbreviation: competitor.team.abbreviation,
          score: competitor.score ?? null,
        }
      : null;
  };
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    status: status?.type?.shortDetail ?? status?.type?.detail ?? "Scheduled",
    completed: Boolean(status?.type?.completed),
    home: getTeam("home"),
    away: getTeam("away"),
  };
}

export function mapOddsScheduleGame(event) {
  if (!event?.id || !event.home_team || !event.away_team || !event.commence_time) {
    return null;
  }
  return {
    id: event.id,
    name: event.name ?? `${event.away_team} at ${event.home_team}`,
    date: event.commence_time,
    status: "Scheduled",
    completed: false,
    home: {
      id: null,
      name: event.home_team,
      abbreviation: "",
      score: null,
    },
    away: {
      id: null,
      name: event.away_team,
      abbreviation: "",
      score: null,
    },
  };
}

export function makeSportTeamTrends(games) {
  const records = new Map();
  for (const game of games) {
    if (!game.completed || !game.home?.id || !game.away?.id) continue;
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
