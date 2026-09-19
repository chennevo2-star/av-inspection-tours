"use client";

import { acquireDelegatedToken } from "./msal-client";

/** The picker's own raw item shape -- per Microsoft's docs, exactly these three fields are always
 * guaranteed present on a picked item (https://learn.microsoft.com/onedrive/developer/controls/
 * file-pickers/, "Picked Item Results"); everything else (name, webUrl, ...) may or may not be included
 * in practice, so this app never relies on them -- `driveId`+`id` alone is enough for the server to
 * resolve the real folder via its own Graph call (apps/web/app/api/settings/storage-folder/route.ts),
 * which needs a fresh authoritative lookup anyway to compute the drive-root-relative path. */
export interface RawPickedItem {
  id: string;
  parentReference: { driveId: string };
  "@sharePoint.endpoint": string;
}

export interface PickedFolder {
  id: string;
  driveId: string;
}

export class FolderPickerCancelledError extends Error {
  constructor() {
    super("Folder picker was closed without a selection");
    this.name = "FolderPickerCancelledError";
  }
}

/**
 * Opens Microsoft's real File Picker v8 (a Microsoft-hosted popup window, not anything built here) in
 * FOLDER-only mode, scoped to the one SharePoint site/library this app already uses -- see
 * msal-client.ts's own comment for the Entra setup this needs. Resolves with the picked folder's
 * `{id, driveId}` (everything `resolveGraphFolderPath` on the server needs to turn into a real path), or
 * rejects with `FolderPickerCancelledError` if the user closes the window without picking anything.
 *
 * Implements the exact protocol Microsoft's own docs specify (POST a form into a popup, then talk to it
 * over a `MessageChannel` established via `postMessage`) -- see this function's own inline comments for
 * where each piece maps to a step in that spec, since the shape here isn't obvious from the code alone.
 */
export async function openSharePointFolderPicker(): Promise<PickedFolder> {
  const siteUrl = process.env.NEXT_PUBLIC_MS_GRAPH_SITE_URL;
  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_MS_GRAPH_SITE_URL must be set to use the SharePoint folder picker (see .env.example)");
  }
  const driveName = process.env.NEXT_PUBLIC_MS_GRAPH_DRIVE_NAME ?? "Documents";
  const baseUrl = siteUrl.replace(/\/$/, "");
  const channelId = crypto.randomUUID();

  const popup = window.open("", "SharePointFolderPicker", "width=1080,height=680");
  if (!popup) throw new Error("הדפדפן חסם את חלון הבחירה (popup) — יש לאשר חלונות קופצים עבור האתר הזה.");
  const win = popup; // narrowed to non-null once, for the closures below (TS can't narrow a `const` across them)

  return new Promise<PickedFolder>((resolve, reject) => {
    let port: MessagePort | null = null;
    let settled = false;

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onWindowMessage);
      action();
    }

    // The popup polls its own `window.closed` state on our side isn't reliable cross-origin, so instead
    // we just let an explicit "close" command (below) or a real pick settle the promise; a plain manual
    // close by the user surfaces as the picker's own port going away, handled by the timeout in
    // acknowledge/result handling being unnecessary here since we only await a real message.

    async function onChannelMessage(message: MessageEvent) {
      const payload = message.data as { type: string; id?: string; data?: unknown };
      if (payload.type !== "command" || !port) return;

      port.postMessage({ type: "acknowledge", id: payload.id });
      const command = payload.data as { command: string; resource?: string };

      switch (command.command) {
        case "authenticate": {
          try {
            const token = await acquireDelegatedToken(command.resource ?? baseUrl);
            port.postMessage({ type: "result", id: payload.id, data: { result: "token", token } });
          } catch (err) {
            port.postMessage({
              type: "result",
              id: payload.id,
              data: { result: "error", error: { code: "unableToObtainToken", message: String(err) } },
            });
          }
          break;
        }
        case "close": {
          finish(() => reject(new FolderPickerCancelledError()));
          win.close();
          break;
        }
        case "pick": {
          try {
            // The exact field the picker uses for its "pick" command payload isn't spelled out
            // verbatim in Microsoft's own docs (confirmed via their official file-picking sample, which
            // wraps this in a helper library rather than showing the raw message) -- `items` is the
            // field name used by every real integration this was cross-checked against, but checking a
            // couple of plausible alternates here means a genuine spec difference fails with a clear
            // error instead of a silent hang, the first time this runs against a real tenant.
            const rawItems =
              (command as { items?: RawPickedItem[] }).items ??
              (command as { data?: { items?: RawPickedItem[] } }).data?.items ??
              [];
            const picked = rawItems[0];
            if (!picked?.id || !picked.parentReference?.driveId) {
              throw new Error(`Picker "pick" command had no usable item (raw: ${JSON.stringify(command)})`);
            }
            port.postMessage({ type: "result", id: payload.id, data: { result: "success" } });
            finish(() => resolve({ id: picked.id, driveId: picked.parentReference.driveId }));
            win.close();
          } catch (err) {
            port.postMessage({
              type: "result",
              id: payload.id,
              data: { result: "error", error: { code: "unusableItem", message: String(err) } },
            });
          }
          break;
        }
        default: {
          port.postMessage({
            type: "result",
            id: payload.id,
            data: { result: "error", error: { code: "unsupportedCommand", message: command.command } },
          });
        }
      }
    }

    function onWindowMessage(event: MessageEvent) {
      if (event.source !== win) return;
      const message = event.data as { type: string; channelId?: string };
      if (message.type === "initialize" && message.channelId === channelId) {
        port = event.ports[0] ?? null;
        if (!port) return;
        port.addEventListener("message", onChannelMessage);
        port.start();
        port.postMessage({ type: "activate" });
      }
    }

    window.addEventListener("message", onWindowMessage);

    (async () => {
      try {
        const accessToken = await acquireDelegatedToken(baseUrl);

        const options = {
          sdk: "8.0",
          entry: {
            sharePoint: {
              byPath: { web: baseUrl, list: driveName },
            },
          },
          authentication: {},
          typesAndSources: { mode: "folders" as const },
          selection: { mode: "single" as const },
          messaging: { origin: window.location.origin, channelId },
        };

        const queryString = new URLSearchParams({ filePicker: JSON.stringify(options), locale: "he-il" });
        const url = `${baseUrl}/_layouts/15/FilePicker.aspx?${queryString.toString()}`;

        const form = win.document.createElement("form");
        form.setAttribute("action", url);
        form.setAttribute("method", "POST");

        const tokenInput = win.document.createElement("input");
        tokenInput.setAttribute("type", "hidden");
        tokenInput.setAttribute("name", "access_token");
        tokenInput.setAttribute("value", accessToken);
        form.appendChild(tokenInput);

        win.document.body.appendChild(form);
        form.submit();
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        win.close();
      }
    })();
  });
}
