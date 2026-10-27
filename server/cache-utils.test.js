import test from "node:test";
import assert from "node:assert/strict";
import {
  describeOddsQuotaFailure,
  oddsRequestCreditCost,
  shouldRestoreFailure,
} from "./cache-utils.js";

test("does not restore expired or transient network failures from disk", () => {
  assert.equal(
    shouldRestoreFailure({ message: "fetch failed", expiresAt: 20_000 }, 10_000),
    false,
  );
  assert.equal(
    shouldRestoreFailure({ message: "upstream timeout", expiresAt: 20_000 }, 10_000),
    false,
  );
  assert.equal(
    shouldRestoreFailure({ message: "temporary upstream error", expiresAt: 10_000 }, 10_000),
    false,
  );
});

test("restores an active non-transient provider failure until its TTL expires", () => {
  assert.equal(
    shouldRestoreFailure({ message: "HTTP 429: rate limited", expiresAt: 20_000 }, 10_000),
    true,
  );
});

test("describes Odds API quota failures without exposing the API key", () => {
  assert.equal(
    describeOddsQuotaFailure(
      {
        status: "rejected",
        reason: new Error("Upstream request failed (401): Invalid key secret-value"),
      },
      "secret-value",
    ),
    "The Odds API quota check failed: Upstream request failed (401): Invalid key [redacted]. Sportsbook requests are paused to protect the quota.",
  );
});

test("explains when the Odds API quota response has no remaining-credit header", () => {
  assert.equal(
    describeOddsQuotaFailure({ status: "fulfilled", value: [] }, "secret-value"),
    "The Odds API response did not include a valid x-requests-remaining header. Sportsbook requests are paused to protect the quota.",
  );
});

test("does not charge credits for sport lists or event schedules", () => {
  assert.equal(
    oddsRequestCreditCost("https://api.the-odds-api.com/v4/sports"),
    0,
  );
  assert.equal(
    oddsRequestCreditCost("https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=key"),
    0,
  );
});

test("charges odds requests per market and region", () => {
  assert.equal(
    oddsRequestCreditCost("https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us&markets=h2h,spreads,totals"),
    3,
  );
  assert.equal(
    oddsRequestCreditCost("https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us,uk&markets=h2h,totals"),
    4,
  );
});
