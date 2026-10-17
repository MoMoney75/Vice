import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePlayerProps,
  buildAnytimeTouchdownParlays,
} from "./player-props.js";
import { findRelevantNews, mapNflNews } from "./nfl-news.js";

function propEvent(bookmakers) {
  return {
    id: "event-1",
    name: "Seattle Seahawks at Denver Broncos",
    commence_time: "2026-10-18T17:00:00Z",
    home_team: "Denver Broncos",
    away_team: "Seattle Seahawks",
    bookmakers,
  };
}

function book(title, anytimePrice, overPrice, underPrice) {
  return {
    title,
    markets: [
      {
        key: "player_anytime_td",
        outcomes: [{ name: "Yes", description: "Jaxon Smith-Njigba", price: anytimePrice }],
      },
      {
        key: "player_pass_yds",
        outcomes: [
          { name: "Over", description: "Sam Darnold", point: 222.5, price: overPrice },
          { name: "Under", description: "Sam Darnold", point: 222.5, price: underPrice },
        ],
      },
    ],
  };
}

const statistics = {
  stats: {
    categories: [
      {
        name: "passingYards",
        leaders: [{
          value: 1175,
          athlete: { displayName: "Sam Darnold" },
          team: { displayName: "Seattle Seahawks" },
        }],
      },
      {
        name: "receivingTouchdowns",
        leaders: [{
          value: 3,
          athlete: { displayName: "Jaxon Smith-Njigba" },
          team: { displayName: "Seattle Seahawks" },
        }],
      },
    ],
  },
};

const trends = [
  {
    name: "Seattle Seahawks",
    wins: 3,
    losses: 2,
    ties: 0,
    pointsFor: 125,
    pointsAgainst: 100,
    recentGames: [{
      result: "W",
      pointsFor: 28,
      pointsAgainst: 20,
      opponent: "Arizona Cardinals",
    }],
  },
  {
    name: "Denver Broncos",
    wins: 2,
    losses: 3,
    ties: 0,
    pointsFor: 90,
    pointsAgainst: 115,
    recentGames: [],
  },
];

test("builds player prop picks with market, season, matchup, injury, and news evidence", () => {
  const news = mapNflNews({
    articles: [{
      headline: "Seahawks QB Sam Darnold discusses the Denver matchup",
      description: "A report on Seattle's offense.",
      published: "2026-10-15T10:00:00Z",
      links: { web: { href: "https://www.espn.com/nfl/story/1" } },
      categories: [{ type: "team", description: "Seattle Seahawks" }],
    }],
  });
  const picks = analyzePlayerProps(
    [propEvent([
      book("Book A", 110, -110, -110),
      book("Book B", 125, -105, -115),
    ])],
    {
      statistics,
      trends,
      injuryReport: {
        updatedAt: "2026-10-15T10:00:00Z",
        playerStatuses: {
          jaxonsmithnjigba: {
            player: "Jaxon Smith-Njigba",
            position: "WR",
            status: "Questionable",
            detail: "Limited participant at practice.",
            team: "Seattle Seahawks",
          },
        },
      },
      news,
    },
  );

  const passingPick = picks.find((pick) => pick.candidate.marketKey === "player_pass_yds");
  const touchdownPick = picks.find((pick) => pick.candidate.marketKey === "player_anytime_td");

  assert.ok(passingPick);
  assert.equal(passingPick.candidate.playerTeam, "Seattle Seahawks");
  assert.equal(passingPick.candidate.bookmakerCount, 2);
  assert.ok(["Over 222.5", "Under 222.5"].includes(passingPick.candidate.selection));
  assert.equal(passingPick.evidence.seasonStats[0].value, 1175);
  assert.equal(passingPick.evidence.offense.record, "3-2");
  assert.equal(passingPick.evidence.opponent.team, "Denver Broncos");
  assert.match(passingPick.evidence.summary, /points per game/);
  assert.equal(passingPick.evidence.news[0].url, "https://www.espn.com/nfl/story/1");

  assert.ok(touchdownPick);
  assert.equal(touchdownPick.candidate.probabilitySource, "raw implied probability");
  assert.equal(touchdownPick.evidence.injury.status, "Questionable");
  assert.match(touchdownPick.evidence.summary, /not a player projection/);
});

test("requires prices from two books and matches current news to team and player", () => {
  const oneBook = analyzePlayerProps([propEvent([book("Book A", 110, -110, -110)])]);
  assert.deepEqual(oneBook, []);

  const news = mapNflNews({
    articles: [{
      title: "Jets receiver update",
      categories: [{ type: "team", description: "New York Jets" }],
    }],
  });
  assert.equal(findRelevantNews(news, ["New York Jets"]).length, 1);
  assert.equal(findRelevantNews(news, [], ["Garrett Wilson"]).length, 0);
});

test("uses ESPN rosters to identify players missing from leaderboard stats", () => {
  const picks = analyzePlayerProps(
    [propEvent([
      book("Book A", 110, -110, -110),
      book("Book B", 125, -105, -115),
    ])],
    {
      trends,
      playerRosters: new Map([
        ["samdarnold", { team: "Seattle Seahawks", position: "QB" }],
      ]),
    },
  );
  const passingPick = picks.find((pick) => pick.candidate.marketKey === "player_pass_yds");

  assert.ok(passingPick);
  assert.equal(passingPick.candidate.playerTeam, "Seattle Seahawks");
  assert.equal(passingPick.candidate.playerPosition, "QB");
  assert.equal(passingPick.evidence.opponent.team, "Denver Broncos");
});

test("builds two- and three-leg anytime-TD parlays ranked with current offense and opponent defense", () => {
  const nameEventPlayer = (event, player) => ({
    ...event,
    bookmakers: event.bookmakers.map((bookmaker) => ({
      ...bookmaker,
      markets: bookmaker.markets.map((market) =>
        market.key === "player_anytime_td"
          ? {
              ...market,
              outcomes: market.outcomes.map((outcome) => ({
                ...outcome,
                description: player,
              })),
            }
          : market,
      ),
    })),
  });
  const games = [
    nameEventPlayer({
      ...propEvent([
        book("Book A", 180, -110, -110),
        book("Book B", 190, -105, -115),
      ]),
      id: "event-1",
      home_team: "Denver Broncos",
      away_team: "Seattle Seahawks",
    }, "Player One"),
    nameEventPlayer({
      ...propEvent([
        book("Book A", 220, -110, -110),
        book("Book B", 230, -105, -115),
      ]),
      id: "event-2",
      home_team: "Philadelphia Eagles",
      away_team: "Carolina Panthers",
    }, "Player Two"),
    nameEventPlayer({
      ...propEvent([
        book("Book A", 250, -110, -110),
        book("Book B", 260, -105, -115),
      ]),
      id: "event-3",
      home_team: "Buffalo Bills",
      away_team: "Miami Dolphins",
    }, "Player Three"),
  ];
  const picks = analyzePlayerProps(games, {
    trends: [
      { name: "Seattle Seahawks", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
      { name: "Denver Broncos", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 140 },
      { name: "Philadelphia Eagles", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
      { name: "Carolina Panthers", wins: 1, losses: 4, ties: 0, pointsFor: 90, pointsAgainst: 160 },
      { name: "Buffalo Bills", wins: 3, losses: 2, ties: 0, pointsFor: 120, pointsAgainst: 110 },
      { name: "Miami Dolphins", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 130 },
    ],
    playerRosters: new Map([
      ["playerone", { team: "Seattle Seahawks", position: "WR" }],
      ["playertwo", { team: "Philadelphia Eagles", position: "WR" }],
      ["playerthree", { team: "Buffalo Bills", position: "WR" }],
    ]),
  });
  const parlays = buildAnytimeTouchdownParlays(picks, {
    trends: [
      { name: "Seattle Seahawks", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
      { name: "Denver Broncos", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 140 },
      { name: "Philadelphia Eagles", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
      { name: "Carolina Panthers", wins: 1, losses: 4, ties: 0, pointsFor: 90, pointsAgainst: 160 },
      { name: "Buffalo Bills", wins: 3, losses: 2, ties: 0, pointsFor: 120, pointsAgainst: 110 },
      { name: "Miami Dolphins", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 130 },
    ],
  });

  assert.ok(parlays.some((parlay) => parlay.legCount === 2));
  assert.ok(parlays.some((parlay) => parlay.legCount === 3));
  for (const parlay of parlays) {
    assert.equal(new Set(parlay.legs.map((leg) => leg.eventId)).size, parlay.legCount);
    assert.ok(parlay.legs.every((leg) => Number.isFinite(leg.pointsPerGame)));
    assert.ok(parlay.legs.every((leg) => Number.isFinite(leg.opponentPointsAllowedPerGame)));
    assert.ok(parlay.legs.every((leg) => leg.marketPrice !== null));
    assert.ok(parlay.estimatedProbability > 0 && parlay.estimatedProbability < 1);
  }
  const withUnavailablePlayer = buildAnytimeTouchdownParlays(
    picks.map((pick) =>
      ["Player One", "Player Two"].includes(pick.candidate.player)
        ? {
            ...pick,
            evidence: {
              ...pick.evidence,
              injury: {
                status: pick.candidate.player === "Player One" ? "Out" : "PUP",
              },
            },
          }
        : pick,
    ),
    {
      trends: [
        { name: "Seattle Seahawks", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
        { name: "Denver Broncos", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 140 },
        { name: "Philadelphia Eagles", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
        { name: "Carolina Panthers", wins: 1, losses: 4, ties: 0, pointsFor: 90, pointsAgainst: 160 },
        { name: "Buffalo Bills", wins: 3, losses: 2, ties: 0, pointsFor: 120, pointsAgainst: 110 },
        { name: "Miami Dolphins", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 130 },
      ],
    },
  );
  assert.ok(
    withUnavailablePlayer.every((parlay) =>
      parlay.legs.every((leg) => !["Player One", "Player Two"].includes(leg.player)),
    ),
  );
});

test("ranks anytime-TD combinations higher when team scoring and opposing defense trends are favorable", () => {
  const teams = [
    ["Seattle Seahawks", "Denver Broncos"],
    ["Philadelphia Eagles", "Carolina Panthers"],
    ["Buffalo Bills", "Miami Dolphins"],
  ];
  const picks = teams.map(([playerTeam, opponent], index) => ({
    candidate: {
      eventId: `event-${index}`,
      eventName: `${playerTeam} at ${opponent}`,
      commenceTime: "2026-10-18T17:00:00Z",
      homeTeam: opponent,
      awayTeam: playerTeam,
      player: `Player ${index}`,
      playerTeam,
      marketKey: "player_anytime_td",
      selection: "Anytime TD scorer",
      bookmakerQuotes: [
        { bookmaker: "Book A", price: 100, impliedProbability: 0.5 },
        { bookmaker: "Book B", price: 100, impliedProbability: 0.5 },
      ],
    },
    evidence: { injury: null },
  }));
  const trends = [
    { name: "Seattle Seahawks", wins: 4, losses: 1, ties: 0, pointsFor: 200, pointsAgainst: 100 },
    { name: "Denver Broncos", wins: 2, losses: 3, ties: 0, pointsFor: 100, pointsAgainst: 200 },
    { name: "Philadelphia Eagles", wins: 4, losses: 1, ties: 0, pointsFor: 150, pointsAgainst: 100 },
    { name: "Carolina Panthers", wins: 1, losses: 4, ties: 0, pointsFor: 100, pointsAgainst: 150 },
    { name: "Buffalo Bills", wins: 2, losses: 3, ties: 0, pointsFor: 50, pointsAgainst: 100 },
    { name: "Miami Dolphins", wins: 2, losses: 3, ties: 0, pointsFor: 50, pointsAgainst: 50 },
  ];

  const [topParlay] = buildAnytimeTouchdownParlays(picks, {
    trends,
    maxPerLegCount: 1,
  });
  assert.deepEqual(
    topParlay.legs.map((leg) => leg.playerTeam).sort(),
    ["Philadelphia Eagles", "Seattle Seahawks"],
  );
});
