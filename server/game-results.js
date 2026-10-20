function numberFromStat(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function formatPlayerLine(group, athlete) {
  const labels = group.labels ?? [];
  const values = athlete.stats ?? [];
  const field = (...names) => {
    const index = labels.findIndex((label) => names.includes(label));
    return index < 0 ? null : values[index] ?? null;
  };
  const stats = [];

  if (group.name === "passing") {
    const completions = field("C/ATT", "CMP/ATT", "COMP/ATT");
    const yards = field("YDS");
    const touchdowns = field("TD");
    const interceptions = field("INT");
    if (completions) stats.push(completions);
    if (yards !== null) stats.push(`${yards} YDS`);
    if (touchdowns !== null) stats.push(`${touchdowns} TD`);
    if (interceptions !== null) stats.push(`${interceptions} INT`);
  } else if (group.name === "rushing") {
    const carries = field("CAR", "ATT");
    const yards = field("YDS");
    const touchdowns = field("TD");
    if (carries !== null) stats.push(`${carries} CAR`);
    if (yards !== null) stats.push(`${yards} YDS`);
    if (touchdowns !== null) stats.push(`${touchdowns} TD`);
  } else if (group.name === "receiving") {
    const receptions = field("REC");
    const yards = field("YDS");
    const touchdowns = field("TD");
    if (receptions !== null) stats.push(`${receptions} REC`);
    if (yards !== null) stats.push(`${yards} YDS`);
    if (touchdowns !== null) stats.push(`${touchdowns} TD`);
  }

  return stats.join(", ");
}

function leader(group) {
  const yardsIndex = group.labels?.indexOf("YDS") ?? -1;
  if (yardsIndex < 0) return null;
  return (group.athletes ?? [])
    .map((athlete) => ({
      athlete,
      yards: numberFromStat(athlete.stats?.[yardsIndex]),
    }))
    .filter((item) => item.yards !== null && item.athlete.athlete?.displayName)
    .sort((a, b) => b.yards - a.yards)[0]?.athlete ?? null;
}

export function buildKeyPlayers(game, summary) {
  const results = [];
  const teams = summary?.boxscore?.players ?? [];

  for (const teamBox of teams) {
    const teamId = teamBox.team?.id;
    const team = teamId === game.home?.id
      ? game.home.name
      : teamId === game.away?.id
        ? game.away.name
        : teamBox.team?.displayName ?? teamBox.team?.name;
    const groups = new Map(
      (teamBox.statistics ?? []).map((group) => [group.name, group]),
    );
    for (const groupName of ["passing", "rushing", "receiving"]) {
      const group = groups.get(groupName);
      const topPlayer = group ? leader(group) : null;
      if (!topPlayer) continue;
      const name = topPlayer.athlete.displayName;
      const entry = results.find((item) => item.name === name && item.team === team);
      const stat = formatPlayerLine(group, topPlayer);
      if (!stat) continue;
      if (entry) entry.stats.push(stat);
      else results.push({ name, team, stats: [stat] });
    }
  }

  return results.map(({ name, team, stats }) => ({
    name,
    team,
    stats: stats.join(" · "),
  }));
}
