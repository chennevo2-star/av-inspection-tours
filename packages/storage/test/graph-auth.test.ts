import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphAuth } from "../src/graph-auth.js";
import { GraphFetchMock, jsonResponse, tokenResponse } from "./support/graph-fetch-mock.js";

describe("GraphAuth (Entra ID app-only client-credentials flow)", () => {
  let fetchMock: GraphFetchMock;

  beforeEach(() => {
    fetchMock = new GraphFetchMock();
    vi.stubGlobal("fetch", fetchMock.fn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function makeAuth(overrides: Partial<{ authorityBaseUrl: string }> = {}) {
    return new GraphAuth({
      tenantId: "tenant-123",
      clientId: "client-456",
      clientSecret: "secret-789",
      ...overrides,
    });
  }

  it("requests a token with the correct client-credentials body against the real Entra token endpoint", async () => {
    fetchMock.enqueueResponse(tokenResponse("token-abc"));
    const auth = makeAuth();

    const token = await auth.getAccessToken();

    expect(token).toBe("token-abc");
    expect(fetchMock.calls).toHaveLength(1);
    const call = fetchMock.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token");
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(call.body as string);
    expect(body.get("client_id")).toBe("client-456");
    expect(body.get("client_secret")).toBe("secret-789");
    expect(body.get("grant_type")).toBe("client_credentials");
    // .default -- not a hand-picked narrower scope -- see graph-auth.ts's own comment on why Entra's
    // client-credentials flow only ever honors whatever was admin-consented (Sites.Selected).
    expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  it("caches the token and does not re-request while it's still fresh", async () => {
    fetchMock.enqueueResponse(tokenResponse("token-abc", 3600));
    const auth = makeAuth();

    const first = await auth.getAccessToken();
    const second = await auth.getAccessToken();

    expect(first).toBe("token-abc");
    expect(second).toBe("token-abc");
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("refreshes once the cached token is within the expiry safety margin", async () => {
    vi.useFakeTimers();
    fetchMock.enqueueResponse(tokenResponse("token-first", 120)); // expires in 2 minutes
    const auth = makeAuth();

    await auth.getAccessToken();
    expect(fetchMock.calls).toHaveLength(1);

    // 61s elapsed of the 120s lifetime leaves 59s remaining -- inside the 60s safety margin, so this
    // should trigger a refresh rather than reuse the cached token.
    vi.advanceTimersByTime(61_000);
    fetchMock.enqueueResponse(tokenResponse("token-second", 3600));
    const refreshed = await auth.getAccessToken();

    expect(refreshed).toBe("token-second");
    expect(fetchMock.calls).toHaveLength(2);
  });

  it("de-dupes concurrent getAccessToken() calls into a single in-flight token request", async () => {
    let resolveResponse!: (response: Response) => void;
    fetchMock.enqueue(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );
    const auth = makeAuth();

    const p1 = auth.getAccessToken();
    const p2 = auth.getAccessToken();
    resolveResponse(tokenResponse("token-shared"));
    const [token1, token2] = await Promise.all([p1, p2]);

    expect(token1).toBe("token-shared");
    expect(token2).toBe("token-shared");
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("throws a descriptive error when Entra rejects the credentials", async () => {
    fetchMock.enqueueResponse(
      jsonResponse(401, { error: "invalid_client", error_description: "bad secret" }, "Unauthorized")
    );
    const auth = makeAuth();

    await expect(auth.getAccessToken()).rejects.toThrow(/Entra ID token request failed \(401/);
  });
});
