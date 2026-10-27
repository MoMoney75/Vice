const DAY_MS = 24 * 60 * 60 * 1000;

export function buildDailyScoreboardRequests({
  espnPath,
  seasonStart,
  periodEnd,
  now,
  futureDays = 7,
}) {
  const currentDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const endDay = Date.UTC(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    periodEnd.getUTCDate(),
  ) + futureDays * DAY_MS;
  const requests = [];

  for (
    let day = Date.UTC(
      seasonStart.getUTCFullYear(),
      seasonStart.getUTCMonth(),
      seasonStart.getUTCDate(),
    );
    day <= endDay;
    day += DAY_MS
  ) {
    const date = new Date(day);
    const dateKey = date.toISOString().slice(0, 10).replaceAll("-", "");
    const dateIsInCurrentPeriod =
      day >= Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - now.getUTCDay(),
      ) &&
      day <= Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - now.getUTCDay() + 6,
      );
    const future = day > currentDay;
    requests.push({
      key: dateKey,
      current: dateIsInCurrentPeriod,
      ttlMs: dateIsInCurrentPeriod ? 60_000 : future ? 6 * 60 * 60 * 1000 : 7 * DAY_MS,
      url: `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${dateKey}&limit=1000`,
    });
  }

  return requests;
}
