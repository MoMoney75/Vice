import assert from "node:assert/strict";
import test from "node:test";
import { buildKeyPlayers } from "./game-results.js";

test("collects each team's passing, rushing, and receiving leaders", () => {
  const game = {
    home: { id: "home", name: "Home" },
    away: { id: "away", name: "Away" },
  };
  const summary = {
    boxscore: {
      players: [
        {
          team: { id: "home" },
          statistics: [
            {
              name: "passing",
              labels: ["C/ATT", "YDS", "TD", "INT"],
              athletes: [
                { athlete: { displayName: "Home QB" }, stats: ["22/31", "248", "2", "1"] },
              ],
            },
            {
              name: "rushing",
              labels: ["CAR", "YDS", "TD"],
              athletes: [
                { athlete: { displayName: "Home RB" }, stats: ["14", "76", "1"] },
                { athlete: { displayName: "Home QB" }, stats: ["4", "20", "0"] },
              ],
            },
            {
              name: "receiving",
              labels: ["REC", "YDS", "TD"],
              athletes: [
                { athlete: { displayName: "Home WR" }, stats: ["5", "68", "1"] },
              ],
            },
          ],
        },
      ],
    },
  };

  assert.deepEqual(buildKeyPlayers(game, summary), [
    { name: "Home QB", team: "Home", stats: "22/31, 248 YDS, 2 TD, 1 INT" },
    { name: "Home RB", team: "Home", stats: "14 CAR, 76 YDS, 1 TD" },
    { name: "Home WR", team: "Home", stats: "5 REC, 68 YDS, 1 TD" },
  ]);
});
