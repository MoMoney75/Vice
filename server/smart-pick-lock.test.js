import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSmartPicks,
  settleSmartPick,
  summarizeSmartPickRecord,
} from "./smart-pick-lock.js";

const candidate = {
  eventId: "game-1",
  eventName: "Away at Home",
  homeTeam: "Home",
  awayTeam: "Away",
  market: "Spread",
  marketKey: "spreads",
  selection: "Home -3",
  line: -3,
};

test("saves a smart pick once and retains it across refreshed candidates", () => {
  const saved = resolveSmartPicks(
    { smartBets: [{ candidate }] },
    [],
    "2026-10-19T12:00:00Z",
  );
  const refreshed = resolveSmartPicks(
    { smartBets: [{ candidate: { ...candidate, selection: "Home -4" } }] },
    saved,
  );
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].candidate.selection, "Home -3");
  assert.equal(refreshed[0].selectedAt, "2026-10-19T12:00:00Z");
});

test("settles smart picks and retains final key-player stats in history", () => {
  const settled = settleSmartPick({ candidate }, {
    completed: true,
    home: { score: "24" },
    away: { score: "20" },
    keyPlayers: [{ name: "Home QB", team: "Home", stats: "22/31 · 248 YDS" }],
  });
  assert.equal(settled.result.outcome, "win");
  assert.deepEqual(summarizeSmartPickRecord([
    { season: 2026, week: 7, picks: [settled] },
  ]).history[0], {
    season: 2026,
    week: 7,
    game: "Away at Home",
    selection: "Home -3",
    market: "Spread",
    result: "win",
    score: "20-24",
    keyPlayers: [{ name: "Home QB", team: "Home", stats: "22/31 · 248 YDS" }],
  });
});

test("grades moneyline and total selections, including a total push", () => {
  const moneyline = {
    ...candidate,
    marketKey: "h2h",
    market: "Moneyline",
    selection: "Away",
    line: null,
  };
  const over = {
    ...candidate,
    marketKey: "totals",
    market: "Total",
    selection: "Over 44",
    line: 44,
  };

  assert.equal(settleSmartPick({ candidate: moneyline }, {
    completed: true,
    home: { score: 20 },
    away: { score: 24 },
  }).result.outcome, "win");
  assert.equal(settleSmartPick({ candidate: over }, {
    completed: true,
    home: { score: 24 },
    away: { score: 20 },
  }).result.outcome, "push");
});
