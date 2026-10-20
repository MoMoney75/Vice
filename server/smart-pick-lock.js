export function resolveSmartPicks(analysis, savedPicks = [], selectedAt = new Date().toISOString()) {
  const picks = new Map(
    savedPicks
      .filter((pick) => pick?.candidate?.eventId)
      .map((pick) => [pick.candidate.eventId, pick]),
  );

  for (const smartBet of analysis.smartBets ?? []) {
    const candidate = smartBet.candidate;
    if (!candidate?.eventId || picks.has(candidate.eventId)) continue;
    picks.set(candidate.eventId, {
      candidate,
      selectedAt,
    });
  }

  return [...picks.values()];
}

export function settleSmartPick(pick, game, settledAt = new Date().toISOString()) {
  if (!pick?.candidate || !game?.completed) return pick;
  const homeScore = Number(game.home?.score);
  const awayScore = Number(game.away?.score);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return pick;
  const keyPlayers = game.keyPlayers ?? [];

  if (pick.result) {
    if (pick.result.keyPlayers?.length || !keyPlayers.length) return pick;
    return { ...pick, result: { ...pick.result, keyPlayers } };
  }

  const candidate = pick.candidate;
  let margin;
  if (candidate.marketKey === "spreads") {
    if (!Number.isFinite(candidate.line)) return pick;
    const homeSelected = candidate.outcomeName === candidate.homeTeam ||
      candidate.selection.startsWith(`${candidate.homeTeam} `);
    const awaySelected = candidate.outcomeName === candidate.awayTeam ||
      candidate.selection.startsWith(`${candidate.awayTeam} `);
    if (homeSelected) margin = homeScore + candidate.line - awayScore;
    else if (awaySelected) margin = awayScore + candidate.line - homeScore;
    else return pick;
  } else if (candidate.marketKey === "h2h") {
    if (
      candidate.outcomeName === candidate.homeTeam ||
      candidate.selection === candidate.homeTeam
    ) margin = homeScore - awayScore;
    else if (
      candidate.outcomeName === candidate.awayTeam ||
      candidate.selection === candidate.awayTeam
    ) margin = awayScore - homeScore;
    else return pick;
  } else if (candidate.marketKey === "totals") {
    if (!Number.isFinite(candidate.line)) return pick;
    const total = homeScore + awayScore;
    if (total === candidate.line) margin = 0;
    else if (candidate.outcomeName === "Over" || candidate.selection.startsWith("Over ")) {
      margin = total - candidate.line;
    } else if (candidate.outcomeName === "Under" || candidate.selection.startsWith("Under ")) {
      margin = candidate.line - total;
    } else return pick;
  } else {
    return pick;
  }

  return {
    ...pick,
    result: {
      outcome: margin > 0 ? "win" : margin < 0 ? "loss" : "push",
      homeScore,
      awayScore,
      keyPlayers,
      settledAt,
    },
  };
}

export function summarizeSmartPickRecord(weeks) {
  const history = weeks
    .flatMap(({ season, week, picks }) =>
      picks.map((pick) => ({
        season,
        week,
        game: pick.candidate.eventName,
        selection: pick.candidate.selection,
        market: pick.candidate.market,
        result: pick.result?.outcome ?? "pending",
        score: pick.result
          ? `${pick.result.awayScore}-${pick.result.homeScore}`
          : null,
        keyPlayers: pick.result?.keyPlayers ?? [],
      })),
    )
    .sort((a, b) => a.season - b.season || a.week - b.week || a.game.localeCompare(b.game));

  return {
    wins: history.filter((pick) => pick.result === "win").length,
    losses: history.filter((pick) => pick.result === "loss").length,
    pushes: history.filter((pick) => pick.result === "push").length,
    pending: history.filter((pick) => pick.result === "pending").length,
    history,
  };
}
