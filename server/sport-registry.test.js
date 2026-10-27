import assert from "node:assert/strict";
import test from "node:test";
import {
  currentSeasonYear,
  getSport,
  getSportPeriod,
} from "./sport-registry.js";

test("sports registry keeps provider details and feature support together", () => {
  assert.equal(getSport("nfl").oddsApiKey, "americanfootball_nfl");
  assert.equal(getSport("nba").espnPath, "basketball/nba");
  assert.equal(getSport("nba").features.playerProps, false);
  assert.equal(getSport("nba").teamIds.length, 30);
  assert.equal(getSport("soccer"), null);
});

test("season year follows league start dates", () => {
  assert.equal(currentSeasonYear("nba", new Date("2026-10-21T12:00:00Z")), 2026);
  assert.equal(currentSeasonYear("nba", new Date("2027-01-10T12:00:00Z")), 2026);
  assert.equal(currentSeasonYear("nfl", new Date("2026-01-10T12:00:00Z")), 2025);
});

test("rolling sport periods are stable within a Sunday-to-Saturday window", () => {
  const first = getSportPeriod(new Date("2026-10-21T12:00:00Z"), "nba");
  const sameWeek = getSportPeriod(new Date("2026-10-24T12:00:00Z"), "nba");
  const nextWeek = getSportPeriod(new Date("2026-10-25T12:00:00Z"), "nba");
  assert.deepEqual(first, sameWeek);
  assert.notEqual(first.key, nextWeek.key);
  assert.match(first.label, /Oct \d+ – Oct \d+/);
});
