// Standalone Node script (NOT run under Vitest) that extracts real x/y text-item coordinates from a PDF
// via pdfjs-dist. Run as a child process from build-pdf.test.ts's own extractTextItems() helper, rather
// than importing pdfjs-dist directly into the Vitest process: pdfjs's `getDocument()` spawns a real
// `worker_threads` Worker, and Vitest's own thread-pool was found to interfere with that in a way that
// makes the spawned worker mis-report its version ("API version 6.3.289 does not match the Worker
// version 6.1.200") even though only one pdfjs-dist is installed and both files agree on disk -- a
// Vitest/Worker interaction, not a real bug. A plain child `node` process has no such interference (the
// exact same code, run this same way, was how the real production regression in this file was
// originally root-caused).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// pathToFileURL(...) wraps: on Windows, a bare `C:\...` path handed straight to import()/Worker() fails
// with ERR_UNSUPPORTED_ESM_URL_SCHEME -- Node's ESM loader only accepts real file:// URLs.
const require = createRequire(import.meta.url);
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;

const pdfPath = process.argv[2];
const data = new Uint8Array(readFileSync(pdfPath));
const doc = await pdfjs.getDocument({ data }).promise;

const items = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (item.str && item.str.trim().length > 0) items.push({ str: item.str, x: item.transform[4] });
  }
}
process.stdout.write(JSON.stringify(items));
