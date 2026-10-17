function parseSpreadLine(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && /^(pk|pick'?em|even)$/i.test(value.trim())) return 0;
  const parsed = Number.parseFloat(String(value).replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function closingHomeSpread(summary) {
  for (const pick of summary?.pickcenter ?? []) {
    const homeLine = parseSpreadLine(pick.pointSpread?.home?.close?.line);
    const awayLine = parseSpreadLine(pick.pointSpread?.away?.close?.line);
    if (
      homeLine !== null &&
      awayLine !== null &&
      Math.abs(homeLine + awayLine) <= 0.1
    ) {
      return homeLine;
    }
  }
  return null;
}

function emptyRecord() {
  return { wins: 0, losses: 0, pushes: 0 };
}

function addResult(record, margin) {
  if (margin > 0) record.wins += 1;
  else if (margin < 0) record.losses += 1;
  else record.pushes += 1;
}

export function buildAgainstTheSpreadRecords(games, summaries) {
  const records = new Map();
  for (const game of games) {
    if (!game.completed || !game.home?.id || !game.away?.id) continue;
    const homeScore = Number(game.home.score);
    const awayScore = Number(game.away.score);
    const homeSpread = closingHomeSpread(summaries.get(game.id));
    if (
      !Number.isFinite(homeScore) ||
      !Number.isFinite(awayScore) ||
      homeSpread === null
    ) continue;

    const homeRecord = records.get(game.home.id) ?? {
      home: emptyRecord(),
      away: emptyRecord(),
    };
    const awayRecord = records.get(game.away.id) ?? {
      home: emptyRecord(),
      away: emptyRecord(),
    };
    const homeMargin = homeScore + homeSpread - awayScore;
    addResult(homeRecord.home, homeMargin);
    addResult(awayRecord.away, -homeMargin);
    records.set(game.home.id, homeRecord);
    records.set(game.away.id, awayRecord);
  }
  return records;
}

export function formatAgainstTheSpread(record) {
  if (!record) return null;
  const total = record.wins + record.losses + record.pushes;
  if (!total) return null;
  return {
    ...record,
    total,
    display: `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ""}`,
  };
}
