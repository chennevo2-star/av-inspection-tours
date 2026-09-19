import { describe, expect, it } from "vitest";
import { formatTourName, formatReportTitle, formatReportSubtitle } from "../lib/format-tour-name";

describe("formatTourName", () => {
  it("does not quote a single category (user request, 2026-09-19: quotes removed from the report's main heading)", () => {
    const name = formatTourName("2026-09-19", "B2tech", ["מולטימדיה"]);
    expect(name).toBe("טופס פיקוח עליון מולטימדיה B2tech 19.09.2026");
    expect(name).not.toContain('"');
  });

  it("still joins multiple categories unquoted with a trailing ו", () => {
    const name = formatTourName("2026-09-19", "B2tech", ["מולטימדיה", "ביטחון"]);
    expect(name).toBe("טופס פיקוח עליון מולטימדיה וביטחון B2tech 19.09.2026");
    expect(name).not.toContain('"');
  });

  it("omits the category segment entirely (not an empty pair of quotes) when there are none", () => {
    const name = formatTourName("2026-09-19", "B2tech", []);
    expect(name).toBe("טופס פיקוח עליון B2tech 19.09.2026");
  });
});

describe("formatReportTitle (user request, 2026-09-19: the report's big cover title carries no categories at all)", () => {
  it("is dash-separated: form name - client - date, no categories", () => {
    expect(formatReportTitle("2026-09-19", "B2tech")).toBe("טופס פיקוח עליון - B2tech - 19.09.2026");
  });

  it("works the same way for a Hebrew project name", () => {
    expect(formatReportTitle("2026-09-19", "פרויקט א")).toBe("טופס פיקוח עליון - פרויקט א - 19.09.2026");
  });
});

describe("formatReportSubtitle (the categories that used to live in the title now live here, on the line underneath)", () => {
  it("lists a single category unquoted", () => {
    expect(formatReportSubtitle(["מולטימדיה"])).toBe("דו״ח פיקוח עליון – מולטימדיה");
  });

  it("joins multiple categories with a trailing ו", () => {
    expect(formatReportSubtitle(["מולטימדיה", "ביטחון"])).toBe("דו״ח פיקוח עליון – מולטימדיה וביטחון");
  });

  it("falls back to the old generic line for a tour that predates the categories feature", () => {
    expect(formatReportSubtitle([])).toBe("דו״ח פיקוח עליון – מערכות מולטימדיה");
  });
});
