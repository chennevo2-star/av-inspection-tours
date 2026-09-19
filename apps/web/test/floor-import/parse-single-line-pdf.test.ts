import { describe, expect, it } from "vitest";
import { detectFloorsFromTextItems, type PositionedText } from "../../lib/floor-import/parse-single-line-pdf";

/**
 * Real coordinates pulled from the user's actual sample riser diagram (מלון הרכס), captured via a one-off
 * PDF.js extraction script and trimmed to the items that matter for this logic -- every floor-code/name
 * label plus a representative sample of "noise" (room counts, cabinet labels, the legend) positioned close
 * enough to floor rows that a naive heuristic could plausibly misfire on them.
 */
const SAMPLE_ITEMS: PositionedText[] = [
  { str: "107", x: 93.9, y: 1048.9 },
  { str: "גג", x: 135.0, y: 1048.9 },
  { str: "מסעדת גג", x: 359.7, y: 1043.3 },
  { str: "ארון תקשורת", x: 553.8, y: 1043.3 },
  { str: "106", x: 105.3, y: 981.4 },
  { str: "2 Suites", x: 304.1, y: 983.5 },
  { str: "23 Rooms", x: 408.1, y: 983.5 },
  { str: "105", x: 105.3, y: 911.0 },
  { str: "6 Suites", x: 304.1, y: 913.2 },
  { str: "104", x: 105.3, y: 840.7 },
  { str: "103", x: 105.3, y: 770.4 },
  { str: "102", x: 105.3, y: 698.6 },
  { str: "101", x: 105.3, y: 628.3 },
  { str: "100L", x: 99.4, y: 556.6 },
  { str: "משרדי מלון", x: 311.4, y: 546.7 },
  { str: "100", x: 105.3, y: 476.4 },
  { str: "BOH", x: 408.4, y: 467.9 },
  { str: "099-G", x: 93.6, y: 421.5 },
  { str: "ספא קומת", x: 1230.0, y: 425.7 },
  { str: "099", x: 105.3, y: 341.3 },
  { str: "098", x: 106.7, y: 263.3 },
  { str: "097", x: 106.7, y: 200.7 },
  // Noise that must NOT be picked up as a floor label.
  { str: "2049-051", x: 215.5, y: 109.9 },
  { str: "Rev. 4", x: 230.5, y: 89.5 },
  { str: "26/06/25", x: 217.0, y: 69.1 },
];

describe("detectFloorsFromTextItems", () => {
  it("finds all 13 floors from the real sample, top to bottom", () => {
    const floors = detectFloorsFromTextItems(SAMPLE_ITEMS);
    expect(floors.map((f) => f.label)).toEqual([
      "107", "106", "105", "104", "103", "102", "101", "100L", "100", "099-G", "099", "098", "097",
    ]);
  });

  it("attaches the name label only to the floor that actually has one", () => {
    const floors = detectFloorsFromTextItems(SAMPLE_ITEMS);
    const byLabel = new Map(floors.map((f) => [f.label, f]));
    expect(byLabel.get("107")?.name).toBe("גג");
    expect(byLabel.get("106")?.name).toBeNull();
    expect(byLabel.get("100L")?.name).toBeNull();
    expect(byLabel.get("099-G")?.name).toBeNull();
  });

  it("parses the leading digit run as floorNumber, including non-plain-numeric labels", () => {
    const floors = detectFloorsFromTextItems(SAMPLE_ITEMS);
    const byLabel = new Map(floors.map((f) => [f.label, f]));
    expect(byLabel.get("107")?.floorNumber).toBe(107);
    expect(byLabel.get("100L")?.floorNumber).toBe(100);
    expect(byLabel.get("099-G")?.floorNumber).toBe(99);
  });

  it("ignores far-right and header/footer noise entirely", () => {
    const floors = detectFloorsFromTextItems(SAMPLE_ITEMS);
    expect(floors).toHaveLength(13);
    expect(floors.some((f) => f.label === "2049-051")).toBe(false);
  });
});
