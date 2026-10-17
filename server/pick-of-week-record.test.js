import assert from "node:assert/strict";
import test from "node:test";
import {
  settlePickOfWeekLock,
  summarizePickOfWeekRecord,
} from "./pick-of-week-lock.js";

function makeLock(candidate, week = 6) {
  return {
    season: 2026,
    week,
    lock: {
      selectedAt: "2026-10-17T12:00:00Z",
      candidate,
    },
  };
}

const homeSpread = {
  eventId: "game-1",
  eventName: "Away at Home",
  homeTeam: "Home",
  awayTeam: "Away",
  market: "Spread",
  marketKey: "spreads",
  outcomeName: "Home",
  selection: "Home -3",
  line: -3,
};

test("grades a spread against the selected team's final score and saved line", () => {
  const savedLock = makeLock(homeSpread).lock;
  const settled = settlePickOfWeekLock(savedLock, {
    completed: true,
    home: { score: "24" },
    away: { score: "20" },
  });

  assert.equal(settled.result.outcome, "win");
  assert.equal(settled.result.homeScore, 24);
  assert.equal(settled.result.awayScore, 20);
  assert.equal(settlePickOfWeekLock(settled, {
    completed: true,
    home: { score: "0" },
    away: { score: "99" },
  }), settled);
});

test("grades underdog spreads and pushes correctly", () => {
  const underdog = {
    ...homeSpread,
    outcomeName: "Away",
    selection: "Away +3",
    line: 3,
  };

  assert.equal(settlePickOfWeekLock(makeLock(underdog).lock, {
    completed: true,
    home: { score: 20 },
    away: { score: 17 },
  }).result.outcome, "push");
  assert.equal(settlePickOfWeekLock(makeLock(underdog).lock, {
    completed: true,
    home: { score: 24 },
    away: { score: 20 },
  }).result.outcome, "loss");
});

test("grades over/under totals and leaves unfinished games pending", () => {
  const over = {
    ...homeSpread,
    market: "Total",
    marketKey: "totals",
    outcomeName: "Over",
    selection: "Over 44.5",
    line: 44.5,
  };
  const under = { ...over, outcomeName: "Under", selection: "Under 44.5" };

  assert.equal(settlePickOfWeekLock(makeLock(over).lock, {
    completed: true,
    home: { score: "24" },
    away: { score: "21" },
  }).result.outcome, "win");
  assert.equal(settlePickOfWeekLock(makeLock(under).lock, {
    completed: true,
    home: { score: "24" },
    away: { score: "21" },
  }).result.outcome, "loss");

  const pending = makeLock(over).lock;
  assert.equal(settlePickOfWeekLock(pending, {
    completed: false,
    home: { score: "0" },
    away: { score: "0" },
  }), pending);
});

test("summarizes wins, losses, pushes, pending picks, and history", () => {
  const first = makeLock(homeSpread);
  const picks = [
    {
      ...first,
      lock: {
        ...first.lock,
        result: { outcome: "win", homeScore: 24, awayScore: 20 },
      },
    },
    {
      ...makeLock({ ...homeSpread, eventId: "game-2" }, 7),
      lock: {
        ...makeLock({ ...homeSpread, eventId: "game-2" }, 7).lock,
        result: { outcome: "loss", homeScore: 17, awayScore: 21 },
      },
    },
    {
      ...makeLock({ ...homeSpread, eventId: "game-3" }, 8),
      lock: {
        ...makeLock({ ...homeSpread, eventId: "game-3" }, 8).lock,
        result: { outcome: "push", homeScore: 20, awayScore: 17 },
      },
    },
    makeLock({ ...homeSpread, eventId: "game-4" }, 9),
  ];

  assert.deepEqual(summarizePickOfWeekRecord(picks), {
    wins: 1,
    losses: 1,
    pushes: 1,
    pending: 1,
    history: [
      { season: 2026, week: 6, game: "Away at Home", selection: "Home -3", market: "Spread", result: "win", score: "20-24" },
      { season: 2026, week: 7, game: "Away at Home", selection: "Home -3", market: "Spread", result: "loss", score: "21-17" },
      { season: 2026, week: 8, game: "Away at Home", selection: "Home -3", market: "Spread", result: "push", score: "17-20" },
      { season: 2026, week: 9, game: "Away at Home", selection: "Home -3", market: "Spread", result: "pending", score: null },
    ],
  });
});
