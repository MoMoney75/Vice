import assert from "node:assert/strict";
import test from "node:test";
import { resolvePickOfWeekLock } from "./pick-of-week-lock.js";

const firstPick = {
  eventId: "game-1",
  eventName: "Away at Home",
  homeTeam: "Home",
  awayTeam: "Away",
  commenceTime: "2026-10-18T17:00:00Z",
  marketKey: "spreads",
  market: "Spread",
  selection: "Home -3",
  line: -3,
  fairProbability: 0.54,
  bestPrice: -105,
  bestBookmaker: "Book A",
  bookCount: 4,
};

test("locks the strongest three-book spread or total for the week", () => {
  const resolved = resolvePickOfWeekLock(
    {
      pickCandidates: [
        { ...firstPick, fairProbability: 0.54 },
        { ...firstPick, eventId: "game-2", selection: "Over 44.5", marketKey: "totals", fairProbability: 0.58, bookCount: 2 },
        { ...firstPick, eventId: "game-3", selection: "Under 44.5", marketKey: "totals", fairProbability: 0.56, bookCount: 3 },
      ],
    },
    null,
    "2026-10-17T12:00:00.000Z",
  );

  assert.equal(resolved.candidate.eventId, "game-3");
  assert.equal(resolved.selectedAt, "2026-10-17T12:00:00.000Z");
  assert.equal(resolved.priceUpdated, true);
});

test("keeps the locked selection while refreshing its confirmed price", () => {
  const savedLock = {
    candidate: firstPick,
    selectedAt: "2026-10-17T12:00:00.000Z",
  };
  const refreshed = {
    ...firstPick,
    fairProbability: 0.51,
    bestPrice: -110,
    bestBookmaker: "Book B",
    bookCount: 5,
  };

  const resolved = resolvePickOfWeekLock(
    { pickCandidates: [refreshed, { ...firstPick, eventId: "new-favorite", fairProbability: 0.7 }] },
    savedLock,
    "2026-10-18T12:00:00.000Z",
  );

  assert.equal(resolved.candidate.eventId, "game-1");
  assert.equal(resolved.candidate.bestPrice, -110);
  assert.equal(resolved.selectedAt, savedLock.selectedAt);
  assert.equal(resolved.priceUpdated, true);
});

test("retains the saved selection and last confirmed price when three-book odds disappear", () => {
  const savedLock = {
    candidate: firstPick,
    selectedAt: "2026-10-17T12:00:00.000Z",
  };

  const resolved = resolvePickOfWeekLock(
    {
      pickCandidates: [
        { ...firstPick, bookCount: 2, bestPrice: 115 },
        { ...firstPick, eventId: "new-favorite", fairProbability: 0.7 },
      ],
    },
    savedLock,
  );

  assert.equal(resolved.candidate.eventId, "game-1");
  assert.equal(resolved.candidate.bestPrice, firstPick.bestPrice);
  assert.equal(resolved.priceUpdated, false);
});

test("breaks equal-probability ties deterministically", () => {
  const first = { ...firstPick, fairProbability: 0.55, eventId: "game-b" };
  const second = { ...firstPick, fairProbability: 0.55, eventId: "game-a", bookCount: 5 };

  const resolved = resolvePickOfWeekLock(
    { pickCandidates: [first, second] },
    null,
    "2026-10-17T12:00:00.000Z",
  );

  assert.equal(resolved.candidate.eventId, "game-a");
});
