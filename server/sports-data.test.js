import assert from "node:assert/strict";
import test from "node:test";
import {
  makeSportTeamTrends,
  mapOddsScheduleGame,
  mapSportGame,
} from "./sports-data.js";

test("normalizes provider game records into a shared game shape", () => {
  const game = mapSportGame({
    id: "espn-1",
    name: "Away at Home",
    date: "2026-10-21T20:00:00Z",
    competitions: [{
      status: { type: { shortDetail: "Final", completed: true } },
      competitors: [
        { homeAway: "away", score: "101", team: { id: "2", displayName: "Away", abbreviation: "AWY" } },
        { homeAway: "home", score: "108", team: { id: "1", displayName: "Home", abbreviation: "HME" } },
      ],
    }],
  });
  assert.deepEqual(game, {
    id: "espn-1",
    name: "Away at Home",
    date: "2026-10-21T20:00:00Z",
    status: "Final",
    completed: true,
    home: { id: "1", name: "Home", abbreviation: "HME", score: "108" },
    away: { id: "2", name: "Away", abbreviation: "AWY", score: "101" },
  });
});

test("normalizes sportsbook-listed NBA events when ESPN schedule data is unavailable", () => {
  assert.deepEqual(mapOddsScheduleGame({
    id: "odds-1",
    name: "Away at Home",
    commence_time: "2026-10-21T20:00:00Z",
    home_team: "Home",
    away_team: "Away",
  }), {
    id: "odds-1",
    name: "Away at Home",
    date: "2026-10-21T20:00:00Z",
    status: "Scheduled",
    completed: false,
    home: { id: null, name: "Home", abbreviation: "", score: null },
    away: { id: null, name: "Away", abbreviation: "", score: null },
  });
  assert.equal(mapOddsScheduleGame({ id: "missing" }), null);
});

test("builds league-neutral team form from completed games", () => {
  const trends = makeSportTeamTrends([{
    id: "game-1",
    date: "2026-10-21T20:00:00Z",
    completed: true,
    home: { id: "1", name: "Home", abbreviation: "HME", score: "108" },
    away: { id: "2", name: "Away", abbreviation: "AWY", score: "101" },
  }]);
  const home = trends.find((team) => team.name === "Home");
  const away = trends.find((team) => team.name === "Away");
  assert.deepEqual([home.wins, home.losses, home.pointDifferential], [1, 0, 7]);
  assert.deepEqual([away.wins, away.losses, away.pointDifferential], [0, 1, -7]);
});

test("ignores completed fallback fixtures without provider team IDs", () => {
  const trends = makeSportTeamTrends([{
    id: "odds-1",
    completed: true,
    home: { id: null, name: "Home", score: "108" },
    away: { id: null, name: "Away", score: "101" },
  }]);
  assert.deepEqual(trends, []);
});
