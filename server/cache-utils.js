export function isTransientNetworkFailure(message) {
  return /fetch failed|timeout|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(
    message ?? "",
  );
}

export function shouldRestoreFailure(failure, now = Date.now()) {
  return (
    failure.expiresAt > now &&
    !isTransientNetworkFailure(failure.message)
  );
}

export function oddsRequestCreditCost(url) {
  const requestUrl = url instanceof URL ? url : new URL(url);
  if (requestUrl.hostname !== "api.the-odds-api.com") return 0;
  if (
    /^\/v4\/sports\/?$/.test(requestUrl.pathname) ||
    /^\/v4\/sports\/[^/]+\/events\/?$/.test(requestUrl.pathname)
  ) return 0;

  const marketCount = (requestUrl.searchParams.get("markets") ?? "h2h").split(",").length;
  const regionCount = (requestUrl.searchParams.get("regions") ?? "us").split(",").length;
  return marketCount * regionCount;
}

export function describeOddsQuotaFailure(result, apiKey) {
  if (result.status === "rejected") {
    const message = result.reason instanceof Error
      ? result.reason.message
      : "Unknown upstream error";
    const safeMessage = apiKey
      ? message.replaceAll(apiKey, "[redacted]")
      : message;
    return `The Odds API quota check failed: ${safeMessage}. Sportsbook requests are paused to protect the quota.`;
  }

  return "The Odds API response did not include a valid x-requests-remaining header. Sportsbook requests are paused to protect the quota.";
}
