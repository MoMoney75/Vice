import assert from "node:assert/strict";
import test from "node:test";
import { settlePickOfWeekLock } from "./pick-of-week-lock.js";
import { findGameForPick } from "./pick-game-match.js";

test("matches sportsbook picks to ESPN results by home and away teams", () => {
  const completedGame = {
    id: "espn-event-id",
    home: { name: "New York Giants" },
    away: { name: "New Orleans Saints" },
    completed: true,
  };

  const lock = {
    candidate: {
      eventId: "sportsbook-event-id",
      homeTeam: "New York Giants",
      awayTeam: "New Orleans Saints",
      marketKey: "spreads",
      outcomeName: "New York Giants",
      selection: "New York Giants -1.5",
      line: -1.5,
    },
  };
  const matchedGame = findGameForPick(lock.candidate, [completedGame]);

  assert.equal(matchedGame, completedGame);
  assert.equal(settlePickOfWeekLock(lock, {
    ...matchedGame,
    home: { ...matchedGame.home, score: "20" },
    away: { ...matchedGame.away, score: "17" },
  }).result.outcome, "win");
});

test("does not match picks when the home and away teams are reversed", () => {
  const game = {
    home: { name: "New York Giants" },
    away: { name: "New Orleans Saints" },
  };

  assert.equal(
    findGameForPick({
      homeTeam: "New Orleans Saints",
      awayTeam: "New York Giants",
    }, [game]),
    null,
  );
});
