export const SPORTS = Object.freeze({
  nfl: Object.freeze({
    id: "nfl",
    label: "NFL",
    espnPath: "football/nfl",
    oddsApiKey: "americanfootball_nfl",
    scheduleType: "weekly",
    seasonYearCutoffMonth: 2,
    periodStartMonth: 8,
    features: Object.freeze({
      playerProps: true,
      news: true,
      injuries: true,
      seasonAts: true,
    }),
  }),
  nba: Object.freeze({
    id: "nba",
    label: "NBA",
    espnPath: "basketball/nba",
    oddsApiKey: "basketball_nba",
    scheduleType: "rolling",
    teamIds: Object.freeze(Array.from({ length: 30 }, (_, index) => String(index + 1))),
    seasonYearCutoffMonth: 9,
    periodStartMonth: 9,
    features: Object.freeze({
      playerProps: false,
      news: true,
      injuries: true,
      seasonAts: true,
    }),
  }),
});

export function getSport(sportId) {
  return SPORTS[sportId] ?? null;
}

export function currentSeasonYear(sportId, date = new Date()) {
  const sport = getSport(sportId);
  if (!sport) throw new Error(`Unsupported sport: ${sportId}`);
  return date.getMonth() < sport.seasonYearCutoffMonth
    ? date.getFullYear() - 1
    : date.getFullYear();
}

export function getSportPeriod(date, sportId) {
  const sport = getSport(sportId);
  if (!sport) throw new Error(`Unsupported sport: ${sportId}`);
  if (sport.scheduleType === "weekly") {
    return {
      key: null,
      label: null,
    };
  }

  const seasonStartYear = currentSeasonYear(sportId, date);
  const seasonStart = new Date(seasonStartYear, sport.periodStartMonth, 1);
  const firstSunday = new Date(seasonStart);
  firstSunday.setDate(seasonStart.getDate() - seasonStart.getDay());
  const currentWeekStart = new Date(date);
  currentWeekStart.setHours(0, 0, 0, 0);
  currentWeekStart.setDate(date.getDate() - date.getDay());
  const week = Math.floor(
    (currentWeekStart.getTime() - firstSunday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  ) + 1;
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 6);
  const format = (value) => value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return {
    key: String(week),
    label: `${format(currentWeekStart)} – ${format(weekEnd)}`,
  };
}
