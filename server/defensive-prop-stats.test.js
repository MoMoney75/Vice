import assert from "node:assert/strict";
import test from "node:test";
import { buildDefensivePropStats } from "./defensive-prop-stats.js";

function offense(teamId, { passYards, passTds, rushYards, rushTds, receptions, receiveYards, receiveTds }) {
  const group = (name, labels, values) => ({
    name,
    labels,
    athletes: [{ stats: values.map(String) }],
  });
  return {
    team: { id: teamId },
    statistics: [
      group("passing", ["YDS", "TD"], [passYards, passTds]),
      group("rushing", ["YDS", "TD"], [rushYards, rushTds]),
      group("receiving", ["REC", "YDS", "TD"], [receptions, receiveYards, receiveTds]),
    ],
  };
}

function completedGame(id, home, away) {
  return {
    id,
    completed: true,
    home: { id: home.id, name: home.name },
    away: { id: away.id, name: away.name },
  };
}

test("aggregates opponent allowed stats and ranks defenses by per-game allowance", () => {
  const games = [
    completedGame("game-1", { id: "defense-a", name: "Defense A" }, { id: "offense-a", name: "Offense A" }),
    completedGame("game-2", { id: "defense-b", name: "Defense B" }, { id: "offense-b", name: "Offense B" }),
    completedGame("game-3", { id: "defense-a", name: "Defense A" }, { id: "offense-c", name: "Offense C" }),
  ];
  const summaries = new Map([
    ["game-1", { boxscore: { players: [
      offense("offense-a", { passYards: 240, passTds: 2, rushYards: 130, rushTds: 2, receptions: 22, receiveYards: 240, receiveTds: 2 }),
      offense("defense-a", { passYards: 150, passTds: 1, rushYards: 60, rushTds: 0, receptions: 14, receiveYards: 150, receiveTds: 1 }),
    ] } }],
    ["game-2", { boxscore: { players: [
      offense("offense-b", { passYards: 180, passTds: 1, rushYards: 80, rushTds: 1, receptions: 18, receiveYards: 180, receiveTds: 1 }),
      offense("defense-b", { passYards: 200, passTds: 1, rushYards: 100, rushTds: 1, receptions: 20, receiveYards: 200, receiveTds: 1 }),
    ] } }],
    ["game-3", { boxscore: { players: [
      offense("offense-c", { passYards: 200, passTds: 1, rushYards: 90, rushTds: 1, receptions: 19, receiveYards: 200, receiveTds: 1 }),
      offense("defense-a", { passYards: 155, passTds: 1, rushYards: 70, rushTds: 0, receptions: 15, receiveYards: 155, receiveTds: 1 }),
    ] } }],
  ]);

  const stats = buildDefensivePropStats(games, summaries);
  const defenseA = stats.get("defensea");
  const defenseB = stats.get("defenseb");

  assert.deepEqual(defenseA.player_rush_yds.stats[0], {
    label: "Rushing yards",
    total: 220,
    games: 2,
    perGame: 110,
  });
  assert.deepEqual(defenseA.player_rush_yds.stats[1], {
    label: "Rushing TDs",
    total: 3,
    games: 2,
    perGame: 1.5,
  });
  assert.equal(defenseA.player_rush_yds.rank, 5);
  assert.equal(defenseB.player_rush_yds.rank, 3);
  assert.equal(defenseA.player_rush_yds.teamsRanked, 5);
  assert.equal(defenseA.player_anytime_td.stats[0].total, 3);
  assert.equal(defenseA.player_anytime_td.stats[1].total, 3);
  assert.equal(defenseA.player_anytime_td.rankMetric, "touchdownsAllowed");
  assert.equal(defenseA.player_pass_yds.stats[0].total, 440);
  assert.equal(defenseA.player_receptions.stats[0].total, 41);
  assert.equal(defenseA.player_reception_yds.stats[0].total, 440);
});
