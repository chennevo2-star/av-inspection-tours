/**
 * Extracts a project's floor list from a "סכמה חד קווית" (single-line riser diagram) PDF (user request).
 * These diagrams, per the real example the user supplied, share one consistent layout convention: each
 * floor is one horizontal row with its level code (e.g. "107", "100L", "099-G") printed hard against the
 * LEFT edge of the page, and -- only when the floor has an actual name (e.g. "גג" for a roof level, as
 * opposed to most floors which are just numbered) -- a short name label sitting just to its right on the
 * same row. This module finds those left-edge codes by position (not by guessing the diagram's drawing
 * structure), then looks for a name label immediately next to each one. It's tuned to this exact
 * convention (the user confirmed future files will share it), not a general "read any engineering
 * drawing" parser -- a file laid out differently would need this tuned differently.
 */

export interface PositionedText {
  str: string;
  x: number;
  y: number;
}

export interface DetectedFloor {
  /** The raw level code as printed, e.g. "100L", "099-G" -- kept verbatim since it's the building's own
   * official floor designation, not something to normalize away. */
  label: string;
  /** A name label found immediately next to the code (e.g. "גג"), or null when the floor is bare-numbered
   * -- matches the user's own "עם שמות אם יש" (with names, if there are any). */
  name: string | null;
  /** The code's leading digit run as a number (e.g. 100 for "100L", 99 for "099-G") -- for Floor.floorNumber,
   * a sort/display aid only; `label` stays the source of truth for the floor's actual designation. */
  floorNumber: number | null;
}

const FLOOR_LABEL_PATTERN = /^\d{2,4}([A-Za-z]|-[A-Za-z]{1,3})?$/;
// Calibrated against the real sample: floor codes sit at x≈94-107, the one observed adjacent name ("גג")
// at x≈135 (41px away); the next real content on any floor's row is 200+ px further out. Generous but
// still well clear of that gap on both sides.
const LEFT_MARGIN_MAX = 160;
const NAME_SEARCH_MAX_DX = 110;
const ROW_Y_TOLERANCE = 4;

/** Pure layout logic, kept separate from PDF.js loading so it's trivially testable with plain fixtures. */
export function detectFloorsFromTextItems(items: PositionedText[]): DetectedFloor[] {
  const labelItems = items.filter((it) => it.x < LEFT_MARGIN_MAX && FLOOR_LABEL_PATTERN.test(it.str.trim()));

  return labelItems
    .map((label) => {
      const nameItem = items.find(
        (it) =>
          it !== label &&
          Math.abs(it.y - label.y) <= ROW_Y_TOLERANCE &&
          it.x > label.x &&
          it.x - label.x <= NAME_SEARCH_MAX_DX &&
          !FLOOR_LABEL_PATTERN.test(it.str.trim())
      );
      const numberMatch = label.str.match(/^\d+/);
      return {
        label: label.str.trim(),
        name: nameItem ? nameItem.str.trim() : null,
        floorNumber: numberMatch ? parseInt(numberMatch[0], 10) : null,
        y: label.y,
      };
    })
    .sort((a, b) => b.y - a.y) // PDF y grows upward -- descending y is top-to-bottom on the page, matching
    // the diagram's own visual order (roof/highest level first), same order Floor.sortOrder should get.
    .map(({ y: _y, ...floor }) => floor);
}

/**
 * Extracts every page's positioned text from raw PDF bytes via PDF.js, then runs the layout logic above.
 * Runs entirely client-side -- the source PDF never needs to be stored anywhere for this one-time import,
 * whichever way its bytes were obtained (a local file, or downloaded from a picked OneDrive item).
 */
export async function extractFloorsFromPdfBytes(data: Uint8Array): Promise<DetectedFloor[]> {
  const pdfjs = await import("pdfjs-dist");
  // A real production bug found here (user report, 2026-09-19, real "undefined is not a function" on a
  // real uploaded riser-diagram PDF): `new URL("pdfjs-dist/...", import.meta.url)` for the worker path is
  // the SAME class of bug already hit once this session with the embedded Hebrew font (see
  // hebrew-font-data.ts's own comment) -- `import.meta.url` doesn't point at a real on-disk/servable
  // location once webpack wraps this module for the browser, so the derived worker URL resolves to
  // nonsense; pdf.js then fails obscurely trying to use a worker that never loaded correctly. Serving the
  // worker file as a plain static public asset (copied once from node_modules/pdfjs-dist/build/, same as
  // this app already does for its logo/fonts) and referencing it by a fixed absolute path sidesteps the
  // whole bundler-resolution problem -- there's no path for a bundler to get wrong.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({ data }).promise;

  const allFloors: DetectedFloor[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PositionedText[] = content.items
      .filter(
        (it): it is typeof it & { str: string; transform: number[] } =>
          "str" in it && "transform" in it && it.str.trim().length > 0
      )
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    allFloors.push(...detectFloorsFromTextItems(items));
  }
  return allFloors;
}

/** Convenience wrapper for the common case (a locally-picked file) -- see extractFloorsFromPdfBytes for
 * anything already in memory as bytes (e.g. a file downloaded from OneDrive). */
export async function extractFloorsFromPdf(file: File): Promise<DetectedFloor[]> {
  return extractFloorsFromPdfBytes(new Uint8Array(await file.arrayBuffer()));
}
