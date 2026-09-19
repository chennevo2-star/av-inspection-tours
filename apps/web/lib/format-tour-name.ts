/**
 * Joins tour category names: no quotes around a single category (user request, 2026-09-19 — an earlier
 * round had quoted a lone category, e.g. "מולטימדיה", which the user asked removed from the report's main
 * heading); two or more are joined unquoted with a trailing "ו" on the last one — standard Hebrew list
 * conjunction (e.g. "מולטימדיה וביטחון", or "מולטימדיה, תקשורת וביטחון" for three).
 */
function formatCategoryList(categories: string[]): string {
  if (categories.length === 1) return categories[0]!;
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

/**
 * The report's own large cover-page title (user request, 2026-09-19: the big heading shouldn't carry the
 * tour's categories at all -- just office form name, client, date; the categories move to
 * `formatReportSubtitle` below, on the line underneath). Deliberately separate from `formatTourName`
 * above, which keeps showing categories inline everywhere else in the app (tour lists, headers, the
 * "continue tour" banner) -- those are plain single-line UI labels with no natural second line to move
 * a category segment to, so that established, already-shipped behavior is left alone here.
 * Dash-separated (not just spaces) so a client name in English never sits directly adjacent to Hebrew
 * text with no visual break between them.
 */
export function formatReportTitle(dateIso: string, projectName: string): string {
  const dateLabel = new Date(dateIso).toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `טופס פיקוח עליון - ${projectName} - ${dateLabel}`;
}

/**
 * The report cover's subtitle line, directly under the title -- now where the tour's categories actually
 * live (see formatReportTitle's own comment). Falls back to the old generic line for a tour that predates
 * the categories feature (empty `categories`), matching how every other empty-categories case in this
 * app degrades gracefully rather than rendering something visibly broken.
 */
export function formatReportSubtitle(categories: string[]): string {
  if (categories.length === 0) return "דו״ח פיקוח עליון – מערכות מולטימדיה";
  return `דו״ח פיקוח עליון – ${formatCategoryList(categories)}`;
}
