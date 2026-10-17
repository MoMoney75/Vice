import assert from "node:assert/strict";
import test from "node:test";
import { filterToSupportedSportsbooks } from "./sportsbook-filter.js";

test("limits event and prop odds to Hard Rock Bet, DraftKings, FanDuel, and Caesars", () => {
  const events = [{
    id: "event-1",
    bookmakers: [
      { key: "hardrockbet" },
      { key: "draftkings" },
      { key: "fanduel" },
      { key: "caesars" },
      { key: "betmgm" },
    ],
  }];

  assert.deepEqual(
    filterToSupportedSportsbooks(events)[0].bookmakers.map((book) => book.key),
    ["hardrockbet", "draftkings", "fanduel", "caesars"],
  );
});

test("preserves events even when none of the selected books offer a market", () => {
  const filtered = filterToSupportedSportsbooks([{
    id: "event-2",
    bookmakers: [{ key: "betmgm" }],
  }]);
  assert.deepEqual(filtered, [{ id: "event-2", bookmakers: [] }]);
});
