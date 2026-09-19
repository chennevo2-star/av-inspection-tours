"use client";

import { acquireDelegatedToken } from "./msal-client";
import { runFilePickerProtocol, PickerCancelledError, type PickedItem } from "./run-picker-protocol";

export type PickedFile = PickedItem;
export { PickerCancelledError as FilePickerCancelledError };

const GRAPH_BASE = "https://graph.microsoft.com";

/**
 * Resolves the signed-in user's own OneDrive site URL via Graph's own `/me/drive` (its real `webUrl`),
 * rather than guessing a "{tenant}-my.sharepoint.com" URL from the SharePoint site config -- that's the
 * common convention but isn't guaranteed for every tenant, and this needs to be right for the picker's
 * popup to load at all.
 */
async function resolveOneDriveSiteUrl(): Promise<string> {
  const token = await acquireDelegatedToken(GRAPH_BASE);
  const res = await fetch(`${GRAPH_BASE}/v1.0/me/drive`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`לא ניתן היה לאתר את ה-OneDrive של המשתמש (קוד ${res.status}).`);
  const drive = (await res.json()) as { webUrl?: string };
  if (!drive.webUrl) throw new Error("Graph לא החזיר כתובת עבור ה-OneDrive של המשתמש.");
  const url = new URL(drive.webUrl);
  return `${url.protocol}//${url.host}`;
}

/**
 * Opens Microsoft's File Picker v8 scoped to the signed-in user's OWN OneDrive (user request: the local
 * device file picker doesn't surface OneDrive as a source on this user's phone) rather than this app's
 * fixed SharePoint site, filtered to `extensions` (e.g. ["pdf"]). Same underlying protocol as
 * open-folder-picker.ts's SharePoint folder picker -- see run-picker-protocol.ts -- and the same one-time
 * Entra admin setup (msal-client.ts's own comment); no additional permission beyond the delegated
 * `Files.Read.All` that setup already grants is needed to read a file's own content afterward.
 */
export async function openOneDriveFilePicker(extensions: string[]): Promise<PickedFile> {
  const baseUrl = await resolveOneDriveSiteUrl();

  return runFilePickerProtocol({
    baseUrl,
    windowName: "OneDriveFilePicker",
    entry: { oneDrive: {} },
    typesAndSources: { mode: "files", filters: extensions },
  });
}

/** Downloads a picked item's raw bytes via Graph -- the picker itself only ever returns `{id, driveId}`,
 * never the file's content. */
export async function downloadPickedFile(picked: PickedFile): Promise<ArrayBuffer> {
  const token = await acquireDelegatedToken(GRAPH_BASE);
  const res = await fetch(`${GRAPH_BASE}/v1.0/drives/${picked.driveId}/items/${picked.id}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`לא ניתן היה להוריד את הקובץ מ-OneDrive (קוד ${res.status}).`);
  return res.arrayBuffer();
}
