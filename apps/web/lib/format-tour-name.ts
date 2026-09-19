/**
 * Canonical display name for a tour (user request: tours should be identified by this name everywhere,
 * not by their bare "#N" inspection number) -- `project.name` doubles as "the client's name" per the
 * user's own clarification, so no separate Project.client field is involved here.
 */
export function formatTourName(dateIso: string, projectName: string): string {
  const dateLabel = new Date(dateIso).toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `סיור פיקוח עליון "${projectName}" ${dateLabel}`;
}
