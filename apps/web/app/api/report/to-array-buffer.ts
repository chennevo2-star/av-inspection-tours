/**
 * A `Buffer`/`Uint8Array`'s own `.buffer` is typed as `ArrayBuffer | SharedArrayBuffer` (a view could in
 * principle wrap either) -- but `NextResponse`'s `BodyInit` typing wants a concrete `ArrayBuffer`. Under
 * TypeScript 5.7+'s generic `Uint8Array<TArrayBuffer>` typing, passing a plain `Buffer`/`Uint8Array`
 * straight into `new NextResponse(...)` now fails to typecheck for exactly this reason (a real,
 * pre-existing gap in this route file predating this change -- confirmed via `git show HEAD:...` against
 * the original file, not something introduced here). Copying into a freshly-allocated `ArrayBuffer`
 * sidesteps the union entirely, same fix as `packPdfToBlob`/`packXlsxToBlob` in
 * packages/report-generator/src/index.ts use for the identical underlying reason.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}
