import assert from "node:assert/strict";
import test from "node:test";
import { selectScheduleWeek } from "./week-schedule.js";

function event(id, completed) {
  return {
    id,
    competitions: [{ status: { type: { completed } } }],
  };
}

test("uses the current week's events until every game is complete", () => {
  const currentEvents = [event("final", true), event("upcoming", false)];
  const nextEvents = [event("next-week", false)];

  assert.deepEqual(
    selectScheduleWeek(6, currentEvents, nextEvents),
    { week: 6, events: currentEvents },
  );
});

test("advances to next week's games once the current week is final", () => {
  const nextEvents = [event("next-week", false)];

  assert.deepEqual(
    selectScheduleWeek(6, [event("final-1", true), event("final-2", true)], nextEvents),
    { week: 7, events: nextEvents },
  );
});

test("keeps the current week when next week's schedule is unavailable", () => {
  const currentEvents = [event("final", true)];

  assert.deepEqual(
    selectScheduleWeek(6, currentEvents),
    { week: 6, events: currentEvents },
  );
});
