/**
 * Entra ID (Azure AD) app-only OAuth2 client-credentials flow for Microsoft Graph. This is what lets
 * `MsGraphStorage` call Graph as itself (a background service with no signed-in user), which is the right
 * model here: inspection tours run unattended/offline and sync later, so there's no interactive user
 * session available at upload time to delegate through.
 *
 * ---------------------------------------------------------------------------------------------------
 * ONE-TIME ADMIN SETUP (must be done by a Microsoft 365 / Entra admin before this code can work against a
 * real tenant -- there is no way to do this from code, and skipping any step below leaves the app either
 * non-functional or (worse) scoped more broadly than intended):
 *
 *   1. Register an app in Entra ID: portal.azure.com -> "Microsoft Entra ID" -> "App registrations" ->
 *      "New registration". Single tenant is fine (this app only ever talks to your own tenant). Note the
 *      "Application (client) ID" and "Directory (tenant) ID" from the resulting Overview page.
 *   2. Create a client secret: inside that app registration -> "Certificates & secrets" -> "New client
 *      secret". Copy the secret VALUE immediately (not the Secret ID) -- Entra never shows it again.
 *   3. Grant the *application* permission `Sites.Selected` (Graph, Application type -- not Delegated):
 *      app registration -> "API permissions" -> "Add a permission" -> "Microsoft Graph" -> "Application
 *      permissions" -> search "Sites.Selected" -> add it -> then "Grant admin consent for <tenant>".
 *      Deliberately NOT `Sites.ReadWrite.All`: that would give this one background app write access to
 *      every SharePoint site in the whole tenant. `Sites.Selected` grants it access to *zero* sites by
 *      default -- site-level access is then granted individually in step 4, which is what makes this the
 *      minimum-scope choice the product spec asks for.
 *   4. Grant that app "write" access to the *one* specific SharePoint site (this is the step that actually
 *      activates `Sites.Selected` -- step 3 alone leaves the app with the permission type but no site to
 *      use it on). This is a Graph API call, not a portal checkbox, made ONCE by an admin who already has
 *      Sites.FullControl.All or is a SharePoint/Global admin (e.g. via Graph Explorer while signed in as
 *      that admin, or any authenticated script/`curl`):
 *
 *        First, find the site's id:
 *          GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}
 *          e.g. GET https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/AVInspectionTours
 *          -> take the "id" field from the response (this is the same value MS_GRAPH_SITE_ID below wants).
 *
 *        Then, grant this app "write" on that site (note: this call targets the SITE's own permissions
 *        endpoint, not the app registration -- it's SharePoint, not Entra, that records the grant):
 *          POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
 *          Content-Type: application/json
 *          {
 *            "roles": ["write"],
 *            "grantedToIdentities": [{
 *              "application": { "id": "<the app's Application (client) ID from step 1>", "displayName": "<app display name>" }
 *            }]
 *          }
 *
 *        A 201 response with a "permission" id back confirms the grant. Without this step, every Graph
 *        call this app makes against that site returns 403 even though admin consent was granted in step 3
 *        -- `Sites.Selected` intentionally requires both halves.
 *
 *   5. Identify (or create) the target document library and note its display name (e.g. "Documents") for
 *      `MS_GRAPH_DRIVE_NAME` -- see index.ts / .env.example for the full env var list.
 * ---------------------------------------------------------------------------------------------------
 */

export interface GraphAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Overridable for tests; defaults to the real Entra endpoint. */
  authorityBaseUrl?: string;
}

interface CachedToken {
  accessToken: string;
  /** Wall-clock ms when this token stops being safe to use (already has the refresh margin baked in --
   * see `EXPIRY_SAFETY_MARGIN_MS` below). */
  refreshAtMs: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
}

// Refresh a bit early rather than exactly at expiry -- a request that starts 200ms before the real
// expiry and takes a few hundred ms to reach Graph could otherwise land server-side already-expired.
// Entra tokens for client-credentials are normally valid ~60-90 minutes, so a minute of margin is cheap.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Caches and auto-refreshes the app-only access token used for every Graph call `MsGraphStorage` makes.
 * One instance is shared across all Graph calls (see index.ts's `getStorage()`) so concurrent uploads
 * reuse the same cached token instead of each fetching their own.
 */
export class GraphAuth {
  private cached: CachedToken | null = null;
  /** De-dupes concurrent refreshes -- without this, N concurrent uploads racing a cold cache would each
   * fire their own token request instead of sharing one in-flight refresh. */
  private inFlightRefresh: Promise<string> | null = null;

  constructor(private readonly config: GraphAuthConfig) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.refreshAtMs) {
      return this.cached.accessToken;
    }
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }
    this.inFlightRefresh = this.fetchNewToken().finally(() => {
      this.inFlightRefresh = null;
    });
    return this.inFlightRefresh;
  }

  private async fetchNewToken(): Promise<string> {
    const authorityBase = this.config.authorityBaseUrl ?? "https://login.microsoftonline.com";
    const url = `${authorityBase}/${this.config.tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      // The `.default` scope means "whatever application permissions were admin-consented for this app
      // registration" (i.e. Sites.Selected, granted per graph-auth.ts's own setup comment above) -- Entra
      // does not let a client-credentials request ask for narrower ad-hoc scopes than that.
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Entra ID token request failed (${response.status} ${response.statusText}): ${text}`
      );
    }

    const json = (await response.json()) as TokenResponse;
    this.cached = {
      accessToken: json.access_token,
      refreshAtMs: Date.now() + json.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS,
    };
    return this.cached.accessToken;
  }
}
