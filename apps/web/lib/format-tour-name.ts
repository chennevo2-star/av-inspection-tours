/**
 * Joins tour category names the way the user specified: a single category stays quoted on its own
 * ("מולטימדיה"), while two or more are joined unquoted with a trailing "ו" on the last one — standard
 * Hebrew list conjunction (e.g. "מולטימדיה וביטחון", or "מולטימדיה, תקשורת וביטחון" for three).
 */
function formatCategoryList(categories: string[]): string {
  if (categories.length === 1) return `"${categories[0]}"`;
  const last = categories[categories.length - 1];
  const rest = categories.slice(0, -1);
  return `${rest.join(", ")} ו${last}`;
}

/**
 * Canonical display name for a tour (user request: tours should be identified by this name everywhere,
 * not by their bare "#N" inspection number), now including the tour's category/ies (further user
 * request) -- `project.name` doubles as "the client's name" per the user's own earlier clarification, so
 * no separate Project.client field is involved here. `categories` is empty for tours created before that
 * feature existed; the category segment is simply omitted then, never shown as an empty pair of quotes.
 */
export function formatTourName(dateIso: string, projectName: string, categories: string[] = []): string {
  const dateLabel = new Date(dateIso).toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
  const categoryPart = categories.length > 0 ? ` ${formatCategoryList(categories)}` : "";
  return `טופס פיקוח עליון${categoryPart} ${projectName} ${dateLabel}`;
}
