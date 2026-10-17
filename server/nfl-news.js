function canonical(value) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") ?? "";
}

export function mapNflNews(response) {
  return (response?.articles ?? [])
    .filter((article) => article.headline || article.title)
    .map((article) => ({
      headline: article.headline ?? article.title,
      description: article.description ?? "",
      publishedAt: article.published ?? null,
      url: article.links?.web?.href ?? null,
      teams: (article.categories ?? [])
        .filter((category) => category.type === "team")
        .map((category) => category.description)
        .filter(Boolean),
    }));
}

export function findRelevantNews(news, teamNames = [], playerNames = [], limit = 2) {
  const teams = teamNames.filter(Boolean).map(canonical);
  const teamNicknames = teamNames
    .filter(Boolean)
    .map((name) => canonical(name.split(/\s+/).at(-1)));
  const players = playerNames.filter(Boolean).map(canonical);

  return news
    .filter((article) => {
      const articleTeams = (article.teams ?? []).map(canonical);
      const articleText = canonical(`${article.headline} ${article.description}`);
      return (
        articleTeams.some((name) => teams.includes(name) || teamNicknames.includes(name)) ||
        teams.some((name) => name && articleText.includes(name)) ||
        teamNicknames.some((name) => name && articleText.includes(name)) ||
        players.some((name) => name && articleText.includes(name))
      );
    })
    .slice(0, limit);
}
