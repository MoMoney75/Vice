import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgainstTheSpreadRecords,
  formatAgainstTheSpread,
} from "./against-the-spread.js";

const game = {
  id: "game-1",
  completed: true,
  home: { id: "home", score: "17" },
  away: { id: "away", score: "14" },
};

test("grades home and away ATS using ESPN's closing spread", () => {
  const records = buildAgainstTheSpreadRecords([game], new Map([[
    game.id,
    {
      pickcenter: [{
        pointSpread: {
          home: { close: { line: "+3" } },
          away: { close: { line: "-3" } },
        },
      }],
    },
  ]]));

  assert.deepEqual(records.get("home"), {
    home: { wins: 1, losses: 0, pushes: 0 },
    away: { wins: 0, losses: 0, pushes: 0 },
  });
  assert.deepEqual(records.get("away"), {
    home: { wins: 0, losses: 0, pushes: 0 },
    away: { wins: 0, losses: 1, pushes: 0 },
  });
  assert.deepEqual(formatAgainstTheSpread(records.get("home").home), {
    wins: 1,
    losses: 0,
    pushes: 0,
    total: 1,
    display: "1-0",
  });
});

test("records pushes and pick'em lines", () => {
  const tiedFinal = {
    ...game,
    home: { ...game.home, score: 20 },
    away: { ...game.away, score: 20 },
  };
  const records = buildAgainstTheSpreadRecords([tiedFinal], new Map([[
    game.id,
    {
      pickcenter: [{
        pointSpread: {
          home: { close: { line: "PK" } },
          away: { close: { line: "EVEN" } },
        },
      }],
    },
  ]]));
  assert.equal(records.get("home").home.pushes, 1);
  assert.equal(records.get("away").away.pushes, 1);
});

test("ignores games without completed scores or a verified closing line", () => {
  const incomplete = { ...game, completed: false };
  const noOdds = { ...game, id: "missing" };
  const records = buildAgainstTheSpreadRecords(
    [incomplete, noOdds],
    new Map(),
  );
  assert.equal(records.size, 0);
  assert.equal(formatAgainstTheSpread(undefined), null);
});
