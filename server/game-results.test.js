import assert from "node:assert/strict";
import test from "node:test";
import { buildBasketballKeyPlayers, buildKeyPlayers } from "./game-results.js";

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

test("collects NBA scoring, rebounding, and assist leaders from ESPN boxscores", () => {
  const game = {
    home: { id: "home", name: "Home" },
    away: { id: "away", name: "Away" },
  };
  const teamBox = (teamId, teamName, athletes) => ({
    team: { id: teamId, displayName: teamName },
    statistics: [{
      labels: ["MIN", "PTS", "REB", "AST"],
      athletes,
    }],
  });
  const summary = {
    boxscore: {
      players: [
        teamBox("home", "Home", [
          { athlete: { displayName: "Home Star" }, stats: ["35", "31", "10", "8"] },
          { athlete: { displayName: "Home Guard" }, stats: ["32", "18", "4", "11"] },
        ]),
        teamBox("away", "Away", [
          { athlete: { displayName: "Away Star" }, stats: ["37", "28", "12", "5"] },
        ]),
      ],
    },
  };

  assert.deepEqual(buildBasketballKeyPlayers(game, summary), [
    { name: "Home Star", team: "Home", stats: "PTS 31 · REB 10" },
    { name: "Home Guard", team: "Home", stats: "AST 11" },
    { name: "Away Star", team: "Away", stats: "PTS 28 · REB 12 · AST 5" },
  ]);
});
