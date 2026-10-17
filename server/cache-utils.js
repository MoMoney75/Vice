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
