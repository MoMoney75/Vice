import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeOdds,
  buildPickOfWeek,
  filterOddsToGames,
} from "./market-analysis.js";

function bookmaker(title, homePrice, awayPrice, homeSpread, awaySpread) {
  return {
    title,
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "Home", price: homePrice },
          { name: "Away", price: awayPrice },
        ],
      },
      {
        key: "spreads",
        outcomes: [
          { name: "Home", price: homeSpread.price, point: homeSpread.point },
          { name: "Away", price: awaySpread.price, point: awaySpread.point },
        ],
      },
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: -110, point: 44.5 },
          { name: "Under", price: -110, point: 44.5 },
        ],
      },
    ],
  };
}

function event(id, homePrice, awayPrice, bestHomePrice) {
  return {
    id,
    name: `Home at Away ${id}`,
    home_team: "Home",
    away_team: "Away",
    commence_time: "2026-10-18T17:00:00Z",
    bookmakers: [
      bookmaker("Book A", homePrice, awayPrice, { price: -110, point: -3.5 }, { price: -110, point: 3.5 }),
      bookmaker("Book B", bestHomePrice, awayPrice, { price: -105, point: -3.5 }, { price: -115, point: 3.5 }),
      bookmaker("Book C", homePrice, awayPrice, { price: -110, point: -3.5 }, { price: -110, point: 3.5 }),
    ],
  };
}

test("finds the highest expected-value candidate and reports its best book", () => {
  const result = analyzeOdds([event("1", -150, 130, 100)], {
    trends: [{
      name: "Home",
      wins: 4,
      losses: 2,
      ties: 0,
      homeAts: { wins: 3, losses: 1, pushes: 0 },
      awayAts: { wins: 1, losses: 2, pushes: 0 },
      pointDifferential: 24,
    }],
    injuryReport: {
      updatedAt: "2026-10-15T10:00:00Z",
      teams: {
        home: {
          players: [{ player: "Home QB", position: "QB", status: "Questionable" }],
        },
      },
    },
  });
  const best = result.smartBets[0].candidate;

  assert.equal(best.selection, "Home to win");
  assert.equal(best.bestPrice, 100);
  assert.equal(best.bestBookmaker, "Book B");
  assert.ok(best.expectedValue > 0);
  assert.equal(result.smartBets[0].positiveConsensusEdge, true);
  assert.match(result.smartBets[0].evidence.market, /3 sportsbooks compared/);
  assert.equal(result.smartBets[0].evidence.teams[0].form, "season form unavailable");
  assert.equal(result.smartBets[0].evidence.teams[1].form, "4-2, +24 point differential");
  assert.deepEqual(result.smartBets[0].evidence.teams[1].injuries, [
    "Home QB (QB): questionable",
  ]);
  assert.equal(result.smartBets[0].evidence.teams[1].venue, "home");
  assert.deepEqual(result.smartBets[0].evidence.teams[1].ats, {
    wins: 3,
    losses: 1,
    pushes: 0,
  });
});

test("shows the correct selection-side spread sign in analysis and parlays", () => {
  const game = {
    id: "spread-sign",
    name: "Away at Home",
    home_team: "Home",
    away_team: "Away",
    commence_time: "2026-10-18T17:00:00Z",
    bookmakers: [
      bookmaker("Book A", -200, 170, { price: -110, point: -9 }, { price: -110, point: 9 }),
      bookmaker("Book B", -195, 165, { price: -105, point: -9 }, { price: -115, point: 9 }),
    ],
  };
  const result = analyzeOdds([
    game,
    event("other-1", -150, 130, -145),
    event("other-2", -160, 140, -155),
  ]);
  const analysis = result.smartBets.find((item) => item.eventId === game.id);
  const underdogSpreadCandidate = result.pickCandidates.find(
    (candidate) => candidate.eventId === game.id && candidate.selection === "Away +9",
  );
  const underdogSpread = analysis.candidate.marketKey === "spreads"
    ? analysis.candidate
    : underdogSpreadCandidate;

  assert.equal(underdogSpreadCandidate.selection, "Away +9");
  assert.equal(underdogSpreadCandidate.line, 9);
  assert.equal(underdogSpread.selection, "Away +9");
  assert.equal(underdogSpread.line, 9);
  assert.ok(!result.pickCandidates.some(
    (candidate) =>
      candidate.eventId === game.id &&
      ["Away -9", "Home +9"].includes(candidate.selection),
  ));
  for (const leg of result.parlays.flatMap((parlay) => parlay.legs)) {
    if (leg.eventId === game.id && leg.marketKey === "spreads") {
      assert.ok(["Home -9", "Away +9"].includes(leg.selection));
    }
  }
});

test("does not report value when only one sportsbook provides a market", () => {
  const singleBook = event("single", -150, 130, -150);
  singleBook.bookmakers = [singleBook.bookmakers[0]];

  const result = analyzeOdds([singleBook]);
  assert.equal(result.smartBets[0].candidate, null);
  assert.deepEqual(result.parlays, []);
});

test("parlays combine legs from different games and keep one sportsbook", () => {
  const result = analyzeOdds([
    event("1", -150, 130, -145),
    event("2", -160, 140, -155),
    event("3", -170, 150, -165),
  ]);

  assert.ok(result.parlays.length > 0);
  for (const parlay of result.parlays) {
    assert.equal(new Set(parlay.legs.map((leg) => leg.eventId)).size, parlay.legCount);
    assert.ok(parlay.legs.every((leg) => leg.eventName));
    assert.ok(parlay.legs.every((leg) => Number.isFinite(leg.price)));
    assert.ok(parlay.estimatedProbability > 0 && parlay.estimatedProbability < 1);
  }

  const returnParlays = result.parlays.filter((parlay) => parlay.tier === "higher-payout");
  assert.ok(returnParlays.length > 0);
  assert.ok(returnParlays.every((parlay) =>
    parlay.legs.some((leg) => leg.marketKey === "spreads" || leg.marketKey === "totals"),
  ));
  assert.ok(returnParlays.some((parlay) => parlay.combinedAmericanOdds > 0));
  assert.deepEqual(new Set(returnParlays.map((parlay) => parlay.legCount)), new Set([2, 3]));
  assert.ok(returnParlays.some((parlay) => parlay.legs.some((leg) => leg.marketKey === "totals")));
  assert.ok(returnParlays.some((parlay) => parlay.legs.some((leg) => leg.marketKey === "spreads")));
  assert.ok(result.parlays.some((parlay) => parlay.tier === "higher-hit-rate"));
});

test("filters odds down to scheduled games for the current week", () => {
  const currentWeek = event("this-week", -150, 130, -145);
  const nextWeek = event("next-week", -160, 140, -155);
  nextWeek.home_team = "Future Home";
  nextWeek.away_team = "Future Away";

  const games = [{
    home: { name: "Home" },
    away: { name: "Away" },
  }];
  assert.deepEqual(filterOddsToGames([currentWeek, nextWeek], games), [currentWeek]);
});

test("pick of the week selects only spread or total and includes form and injury context", () => {
  const odds = [event("pick", -150, 130, -145)];
  const analysis = analyzeOdds(odds);
  const pick = buildPickOfWeek({
    analysis,
    week: 7,
    trends: [
      {
        name: "Home",
        wins: 4,
        losses: 2,
        ties: 0,
        pointsFor: 150,
        pointsAgainst: 120,
        pointDifferential: 30,
        homeAts: { wins: 3, losses: 1, pushes: 0 },
        recent: ["W", "L", "W", "W", "W"],
      },
    ],
    injuryReport: {
      updatedAt: "2026-10-15T10:00:00Z",
      teams: {
        home: {
          reportedCount: 1,
          players: [{ player: "Starting QB", position: "QB", status: "Questionable" }],
        },
      },
    },
  });

  assert.equal(pick.week, 7);
  assert.ok(["Spread", "Total"].includes(pick.pick.market));
  assert.equal(pick.context.home.form.record, "4-2");
  assert.equal(pick.context.home.form.pointsForPerGame, 25);
  assert.deepEqual(pick.context.home.ats, {
    wins: 3,
    losses: 1,
    pushes: 0,
  });
  assert.equal(pick.context.home.injury.players[0].position, "QB");
  assert.equal(pick.context.away.injury, null);
  assert.ok(pick.basis.includes("not a validated prediction model"));
});
