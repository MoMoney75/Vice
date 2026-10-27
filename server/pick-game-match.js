function canonicalTeamName(name) {
  return name
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function findGameForPick(candidate, games) {
  const homeTeam = canonicalTeamName(candidate?.homeTeam);
  const awayTeam = canonicalTeamName(candidate?.awayTeam);
  if (!homeTeam || !awayTeam) return null;

  for (const game of games) {
    if (
      canonicalTeamName(game.home?.name) === homeTeam &&
      canonicalTeamName(game.away?.name) === awayTeam
    ) return game;
  }
  return null;
}
