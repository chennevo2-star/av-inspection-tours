"use client";

import { acquireDelegatedToken } from "./msal-client";

/** The picker's own raw item shape -- per Microsoft's docs, exactly these three fields are always
 * guaranteed present on a picked item (https://learn.microsoft.com/onedrive/developer/controls/
 * file-pickers/, "Picked Item Results"); everything else (name, webUrl, ...) may or may not be included
 * in practice, so this app never relies on them. */
export interface RawPickedItem {
  id: string;
  parentReference: { driveId: string };
  "@sharePoint.endpoint": string;
}

export interface PickedItem {
  id: string;
  driveId: string;
}

export class PickerCancelledError extends Error {
  constructor() {
    super("Picker was closed without a selection");
    this.name = "PickerCancelledError";
  }
}

/**
 * The real Microsoft File Picker v8 protocol (a Microsoft-hosted popup window, not anything built here):
 * POST a form with an access token into a popup, then talk to it over a `MessageChannel` established via
 * `postMessage`. Shared by both open-folder-picker.ts (folders, scoped to this app's own SharePoint
 * site) and open-onedrive-file-picker.ts (files, scoped to the signed-in user's own OneDrive) -- they
 * differ only in `baseUrl`/`entry`/`typesAndSources`, everything else about the protocol is identical.
 * See msal-client.ts's own comment for the one-time Entra admin setup this needs.
 */
export async function runFilePickerProtocol(options: {
  baseUrl: string;
  windowName: string;
  entry: Record<string, unknown>;
  typesAndSources: Record<string, unknown>;
}): Promise<PickedItem> {
  const { baseUrl, windowName, entry, typesAndSources } = options;
  const channelId = crypto.randomUUID();

  const popup = window.open("", windowName, "width=1080,height=680");
  if (!popup) throw new Error("הדפדפן חסם את חלון הבחירה (popup) — יש לאשר חלונות קופצים עבור האתר הזה.");
  const win = popup; // narrowed to non-null once, for the closures below (TS can't narrow a `const` across them)

  return new Promise<PickedItem>((resolve, reject) => {
    let port: MessagePort | null = null;
    let settled = false;

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onWindowMessage);
      action();
    }

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
          finish(() => reject(new PickerCancelledError()));
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

        const pickerOptions = {
          sdk: "8.0",
          entry,
          authentication: {},
          typesAndSources,
          selection: { mode: "single" as const },
          messaging: { origin: window.location.origin, channelId },
        };

        const queryString = new URLSearchParams({ filePicker: JSON.stringify(pickerOptions), locale: "he-il" });
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
