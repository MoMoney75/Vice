import { selectPickOfWeekCandidate } from "./market-analysis.js";

function sameSelection(first, second) {
  return (
    first.eventId === second.eventId &&
    first.marketKey === second.marketKey &&
    first.selection === second.selection
  );
}

export function resolvePickOfWeekLock(analysis, savedLock, selectedAt = new Date().toISOString()) {
  if (savedLock?.candidate) {
    if (savedLock.result) {
      return {
        candidate: savedLock.candidate,
        selectedAt: savedLock.selectedAt,
        priceUpdated: false,
        result: savedLock.result,
      };
    }
    const currentCandidate = (analysis.pickCandidates ?? []).find(
      (candidate) =>
        candidate.bookCount >= 2 &&
        sameSelection(candidate, savedLock.candidate),
    );
    return {
      candidate: currentCandidate ?? savedLock.candidate,
      selectedAt: savedLock.selectedAt,
      priceUpdated: Boolean(currentCandidate),
    };
  }

  const candidate = selectPickOfWeekCandidate(analysis);
  return candidate
    ? { candidate, selectedAt, priceUpdated: true }
    : null;
}

export function settlePickOfWeekLock(savedLock, game, settledAt = new Date().toISOString()) {
  const candidate = savedLock?.candidate;
  if (!candidate || !game?.completed) return savedLock;

  const homeScore = Number(game.home?.score);
  const awayScore = Number(game.away?.score);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return savedLock;
  if (savedLock.result) {
    if (savedLock.result.keyPlayers?.length || !game.keyPlayers?.length) return savedLock;
    return {
      ...savedLock,
      result: { ...savedLock.result, keyPlayers: game.keyPlayers },
    };
  }

  let margin;
  if (candidate.marketKey === "spreads") {
    const selectedTeam = candidate.outcomeName ??
      [candidate.homeTeam, candidate.awayTeam].find((team) =>
        candidate.selection.startsWith(`${team} `),
      );
    const selectedScore = selectedTeam === candidate.homeTeam
      ? homeScore
      : selectedTeam === candidate.awayTeam
        ? awayScore
        : null;
    const opponentScore = selectedTeam === candidate.homeTeam
      ? awayScore
      : selectedTeam === candidate.awayTeam
        ? homeScore
        : null;
    if (selectedScore === null || !Number.isFinite(candidate.line)) return savedLock;
    margin = selectedScore + candidate.line - opponentScore;
  } else if (candidate.marketKey === "totals") {
    const total = homeScore + awayScore;
    if (!Number.isFinite(candidate.line)) return savedLock;
    if (total === candidate.line) margin = 0;
    else if (candidate.outcomeName === "Over" || candidate.selection.startsWith("Over ")) {
      margin = total - candidate.line;
    } else if (candidate.outcomeName === "Under" || candidate.selection.startsWith("Under ")) {
      margin = candidate.line - total;
    } else {
      return savedLock;
    }
  } else {
    return savedLock;
  }

  return {
    ...savedLock,
    result: {
      outcome: margin > 0 ? "win" : margin < 0 ? "loss" : "push",
      homeScore,
      awayScore,
      keyPlayers: game.keyPlayers ?? [],
      settledAt,
    },
  };
}

export function summarizePickOfWeekRecord(locks) {
  const history = locks
    .filter(({ lock }) => lock?.candidate)
    .sort((a, b) => a.season - b.season || a.week - b.week)
    .map(({ season, week, lock, periodLabel }) => ({
      season,
      week,
      ...(periodLabel ? { periodLabel } : {}),
      game: lock.candidate.eventName,
      selection: lock.candidate.selection,
      market: lock.candidate.market,
      result: lock.result?.outcome ?? "pending",
      score: lock.result
        ? `${lock.result.awayScore}-${lock.result.homeScore}`
        : null,
      keyPlayers: lock.result?.keyPlayers ?? [],
    }));

  return {
    wins: history.filter((pick) => pick.result === "win").length,
    losses: history.filter((pick) => pick.result === "loss").length,
    pushes: history.filter((pick) => pick.result === "push").length,
    pending: history.filter((pick) => pick.result === "pending").length,
    history,
  };
}
