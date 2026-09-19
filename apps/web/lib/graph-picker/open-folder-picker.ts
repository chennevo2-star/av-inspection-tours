"use client";

import { runFilePickerProtocol, PickerCancelledError, type PickedItem } from "./run-picker-protocol";

export type PickedFolder = PickedItem;
export { PickerCancelledError as FolderPickerCancelledError };

/**
 * Opens Microsoft's real File Picker v8 in FOLDER-only mode, scoped to the one SharePoint site/library
 * this app already uses -- see msal-client.ts's own comment for the Entra setup this needs, and
 * run-picker-protocol.ts for the shared popup/MessageChannel mechanics both this and
 * open-onedrive-file-picker.ts use. Resolves with the picked folder's `{id, driveId}` (everything
 * `resolveGraphFolderPath` on the server needs to turn into a real path), or rejects with
 * `FolderPickerCancelledError` if the user closes the window without picking anything.
 */
export async function openSharePointFolderPicker(): Promise<PickedFolder> {
  const siteUrl = process.env.NEXT_PUBLIC_MS_GRAPH_SITE_URL;
  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_MS_GRAPH_SITE_URL must be set to use the SharePoint folder picker (see .env.example)");
  }
  const driveName = process.env.NEXT_PUBLIC_MS_GRAPH_DRIVE_NAME ?? "Documents";
  const baseUrl = siteUrl.replace(/\/$/, "");

  return runFilePickerProtocol({
    baseUrl,
    windowName: "SharePointFolderPicker",
    entry: { sharePoint: { byPath: { web: baseUrl, list: driveName } } },
    typesAndSources: { mode: "folders" },
  });
}
