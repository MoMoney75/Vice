import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyScoreboardRequests } from "./sport-schedule.js";

test("requests one ESPN scoreboard date per day for the season and near-future slate", () => {
  const requests = buildDailyScoreboardRequests({
    espnPath: "basketball/nba",
    seasonStart: new Date("2026-10-01T00:00:00Z"),
    periodEnd: new Date("2026-10-24T00:00:00Z"),
    now: new Date("2026-10-21T22:00:00Z"),
    futureDays: 7,
  });

  assert.equal(requests.length, 31);
  assert.equal(requests[0].key, "20261001");
  assert.equal(requests.at(-1).key, "20261031");
  assert.ok(requests.every(({ url }) => !url.includes("-2026")));
  assert.ok(requests.find(({ key }) => key === "20261021").current);
  assert.equal(requests.find(({ key }) => key === "20261021").ttlMs, 60_000);
  assert.equal(requests.find(({ key }) => key === "20261020").ttlMs, 60_000);
  assert.equal(requests.find(({ key }) => key === "20261031").ttlMs, 6 * 60 * 60 * 1000);
});

test("daily scoreboard URL uses ESPN's supported single-day dates parameter", () => {
  const [request] = buildDailyScoreboardRequests({
    espnPath: "basketball/nba",
    seasonStart: new Date("2026-10-21T00:00:00Z"),
    periodEnd: new Date("2026-10-21T00:00:00Z"),
    now: new Date("2026-10-21T22:00:00Z"),
    futureDays: 0,
  });
  assert.match(request.url, /scoreboard\?dates=20261021&limit=1000$/);
});
