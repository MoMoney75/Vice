export const ALLOWED_SPORTSBOOK_KEYS = Object.freeze([
  "hardrockbet",
  "draftkings",
  "fanduel",
  "caesars",
]);

const allowedBookmakers = new Set(ALLOWED_SPORTSBOOK_KEYS);

export function filterToSupportedSportsbooks(events) {
  return events.map((event) => ({
    ...event,
    bookmakers: (event.bookmakers ?? []).filter((bookmaker) =>
      allowedBookmakers.has(bookmaker.key?.toLowerCase()),
    ),
  }));
}
