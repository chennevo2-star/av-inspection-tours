import { describe, expect, it } from "vitest";
import { formatTourName } from "../lib/format-tour-name";

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
