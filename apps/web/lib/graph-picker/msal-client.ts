"use client";

import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

/**
 * Delegated (user-signed-in) Microsoft auth for the SharePoint folder picker (apps/web/app/settings/
 * storage-folder) -- separate from, and in ADDITION to, the app-only client-credentials flow
 * packages/storage/src/graph-auth.ts already uses for real uploads. The picker itself only ever runs
 * client-side as whichever human clicks "בחר תיקייה" -- it needs its own delegated permissions, and it's
 * used ONCE per folder change (to browse and pick), never for the app's ongoing uploads, which keep using
 * the existing app-only credentials against whatever folder path gets saved.
 *
 * ---------------------------------------------------------------------------------------------------
 * ONE-TIME ADMIN SETUP (in addition to graph-auth.ts's app-only setup -- both are required, this doesn't
 * replace that one):
 *
 *   1. Same app registration as graph-auth.ts's step 1 (reuse it -- no need for a second one). Open it in
 *      the Entra portal -> "Authentication" -> "Add a platform" -> "Single-page application".
 *   2. Set the redirect URI to this app's real deployed origin (e.g.
 *      "https://av-inspection-tours.chennevo2.workers.dev") -- and ALSO add "http://localhost:3000" for
 *      local dev. Both "Access tokens" and "ID tokens" checkboxes must be checked.
 *   3. Under "API permissions" -> "Add a permission" -> "Microsoft Graph" -> "Delegated permissions", add:
 *      Files.Read.All, Sites.Read.All, User.Read. Then "Add a permission" -> "SharePoint" -> "Delegated
 *      permissions", add: AllSites.Read, MyFiles.Read. Then "Grant admin consent for <tenant>" -- the
 *      picker is READ-ONLY (it only needs to see folders to let the user pick one; actual uploads never go
 *      through this delegated token), so this deliberately does NOT request any *.ReadWrite permission.
 *   4. Set NEXT_PUBLIC_MS_GRAPH_CLIENT_ID / NEXT_PUBLIC_MS_GRAPH_TENANT_ID / NEXT_PUBLIC_MS_GRAPH_SITE_URL
 *      / NEXT_PUBLIC_MS_GRAPH_DRIVE_NAME (see .env.example) and redeploy -- these are all safe to expose
 *      to the browser (the client ID is not a secret; only MS_GRAPH_CLIENT_SECRET is).
 * ---------------------------------------------------------------------------------------------------
 */

let app: PublicClientApplication | null = null;
let initialized: Promise<void> | null = null;

function config(): Configuration {
  const clientId = process.env.NEXT_PUBLIC_MS_GRAPH_CLIENT_ID;
  const tenantId = process.env.NEXT_PUBLIC_MS_GRAPH_TENANT_ID;
  if (!clientId || !tenantId) {
    throw new Error(
      "NEXT_PUBLIC_MS_GRAPH_CLIENT_ID and NEXT_PUBLIC_MS_GRAPH_TENANT_ID must be set to use the SharePoint folder picker (see .env.example)"
    );
  }
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: typeof window !== "undefined" ? window.location.origin : undefined,
    },
    cache: {
      // sessionStorage (not localStorage): this token is only ever needed for the picker action itself,
      // never persisted across app restarts -- ongoing uploads use the server's own app-only credentials.
      cacheLocation: "sessionStorage",
    },
  };
}

/** Lazily created and initialized exactly once (MSAL requires an async `initialize()` call before any
 * other method) -- every caller just awaits this instead of managing that sequencing itself. */
async function getMsalApp(): Promise<PublicClientApplication> {
  if (!app) {
    app = new PublicClientApplication(config());
    initialized = app.initialize();
  }
  await initialized;
  return app;
}

/** Acquires a delegated access token for `resource` (a Graph or SharePoint base URL), interactively
 * signing the user in via a popup the first time and reusing a cached/silently-refreshed token after
 * that -- exactly the pattern Microsoft's own File Picker v8 integration guide documents. */
export async function acquireDelegatedToken(resource: string): Promise<string> {
  const msal = await getMsalApp();
  const authParams = { scopes: [`${resource.replace(/\/$/, "")}/.default`] };

  try {
    const active = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
    if (active) {
      const result = await msal.acquireTokenSilent({ ...authParams, account: active });
      return result.accessToken;
    }
    throw new Error("no cached account");
  } catch {
    const result = await msal.loginPopup(authParams);
    msal.setActiveAccount(result.account);
    if (result.accessToken) return result.accessToken;
    const silent = await msal.acquireTokenSilent({ ...authParams, account: result.account });
    return silent.accessToken;
  }
}
