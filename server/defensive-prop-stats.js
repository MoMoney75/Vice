function canonical(value) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const METRICS = {
  passingYards: { group: "passing", label: "Passing yards", stat: "YDS" },
  passingTouchdowns: { group: "passing", label: "Passing TDs", stat: "TD" },
  rushingYards: { group: "rushing", label: "Rushing yards", stat: "YDS" },
  rushingTouchdowns: { group: "rushing", label: "Rushing TDs", stat: "TD" },
  receivingYards: { group: "receiving", label: "Receiving yards", stat: "YDS" },
  receivingTouchdowns: { group: "receiving", label: "Receiving TDs", stat: "TD" },
  receptions: { group: "receiving", label: "Receptions", stat: "REC" },
};

const MARKETS = {
  player_anytime_td: {
    rankMetric: "touchdownsAllowed",
    metrics: ["rushingTouchdowns", "receivingTouchdowns"],
  },
  player_pass_yds: {
    rankMetric: "passingYards",
    metrics: ["passingYards", "passingTouchdowns"],
  },
  player_rush_yds: {
    rankMetric: "rushingYards",
    metrics: ["rushingYards", "rushingTouchdowns"],
  },
  player_receptions: {
    rankMetric: "receptions",
    metrics: ["receptions", "receivingYards", "receivingTouchdowns"],
  },
  player_reception_yds: {
    rankMetric: "receivingYards",
    metrics: ["receivingYards", "receivingTouchdowns"],
  },
};

function numericValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function getGroupStat(group, statName) {
  const index = group?.labels?.indexOf(statName) ?? -1;
  if (index < 0) return null;
  let total = 0;
  for (const athlete of group.athletes ?? []) {
    const value = numericValue(athlete.stats?.[index]);
    if (value === null) continue;
    total += value;
  }
  return total;
}

function summarizeMetric(metricName, metric, label = METRICS[metricName]?.label) {
  return {
    label: label ?? "Touchdowns",
    total: metric.total,
    games: metric.games,
    perGame: metric.total / metric.games,
  };
}

export function buildDefensivePropStats(games, summaries) {
  const teams = new Map();
  const getTeam = (name) => {
    const key = canonical(name);
    if (!key) return null;
    const team = teams.get(key) ?? { name, metrics: {} };
    teams.set(key, team);
    return team;
  };

  for (const game of games) {
    if (!game.completed || !game.home?.id || !game.away?.id) continue;
    const summary = summaries.get(game.id);
    const offenseTeams = summary?.boxscore?.players ?? [];
    for (const offense of offenseTeams) {
      const offenseId = offense.team?.id;
      if (!offenseId) continue;
      const defenseName = offenseId === game.home.id
        ? game.away.name
        : offenseId === game.away.id
          ? game.home.name
          : null;
      const defense = getTeam(defenseName);
      if (!defense) continue;

      const groups = new Map(
        (offense.statistics ?? []).map((group) => [group.name, group]),
      );
      for (const [metricName, config] of Object.entries(METRICS)) {
        const group = groups.get(config.group);
        const value = getGroupStat(group, config.stat);
        if (value === null) continue;
        const metric = defense.metrics[metricName] ?? { total: 0, games: 0 };
        metric.total += value;
        metric.games += 1;
        defense.metrics[metricName] = metric;
      }
    }
  }

  for (const [marketKey, config] of Object.entries(MARKETS)) {
    const eligible = [...teams.values()]
      .map((team) => {
        const rushingTouchdowns = team.metrics.rushingTouchdowns;
        const receivingTouchdowns = team.metrics.receivingTouchdowns;
        const touchdownsAllowed =
          rushingTouchdowns?.games && receivingTouchdowns?.games
            ? {
                total: rushingTouchdowns.total + receivingTouchdowns.total,
                games: Math.min(rushingTouchdowns.games, receivingTouchdowns.games),
              }
            : null;
        const rankMetric = config.rankMetric === "touchdownsAllowed"
          ? touchdownsAllowed
          : team.metrics[config.rankMetric];
        return { team, touchdownsAllowed, rankMetric };
      })
      .filter((item) => item.rankMetric?.games);
    const sorted = eligible
      .map(({ rankMetric }) => rankMetric.total / rankMetric.games)
      .sort((a, b) => a - b);

    for (const { team, touchdownsAllowed, rankMetric } of eligible) {
      const rankValue = rankMetric.total / rankMetric.games;
      const stats = config.metrics.map((metricName) => {
        const metric = metricName === "touchdownsAllowed"
          ? touchdownsAllowed
          : team.metrics[metricName];
        return metric?.games
          ? summarizeMetric(
              metricName,
              metric,
              metricName === "touchdownsAllowed"
                ? "Rushing and receiving TDs"
                : undefined,
            )
          : null;
      }).filter(Boolean);
      team[marketKey] = {
        rankMetric: config.rankMetric,
        rank: sorted.filter((value) => value < rankValue).length + 1,
        teamsRanked: sorted.length,
        games: rankMetric.games,
        stats,
      };
    }
  }

  return new Map([...teams].map(([name, team]) => [name, Object.fromEntries(
    Object.keys(MARKETS)
      .filter((marketKey) => team[marketKey])
      .map((marketKey) => [marketKey, team[marketKey]]),
  )]));
}
