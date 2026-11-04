const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

/** Badge class for a selection score. */
export function scoreClass(score: number, selected: boolean): string {
  if (selected) return "badge brand";
  return score > 0 ? "badge" : "badge muted";
}
