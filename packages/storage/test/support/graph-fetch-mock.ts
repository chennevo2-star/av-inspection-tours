import { vi } from "vitest";

/** One recorded call this mock's `fetch` replacement observed. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

/**
 * A queue-based `fetch` replacement for contract-testing MsGraphStorage/GraphAuth against Microsoft
 * Graph's real REST shape without a live tenant. Each test enqueues the exact sequence of responses it
 * expects the code under test to need (auth token, drive lookup, folder GETs/POSTs, uploads, ...) and can
 * then assert on `calls` -- the real request URLs/methods/headers/bodies the code actually sent, not just
 * "it didn't throw".
 */
export class GraphFetchMock {
  calls: RecordedCall[] = [];
  private queue: Responder[] = [];

  enqueue(responder: Responder): void {
    this.queue.push(responder);
  }

  enqueueResponse(response: Response): void {
    this.queue.push(() => response);
  }

  enqueueError(error: Error): void {
    this.queue.push(() => {
      throw error;
    });
  }

  fn = vi.fn(async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    if (init.headers) {
      new Headers(init.headers as HeadersInit).forEach((value, key) => {
        headers[key] = value;
      });
    }
    const call: RecordedCall = { url, method: init.method ?? "GET", headers, body: init.body };
    this.calls.push(call);

    const responder = this.queue.shift();
    if (!responder) {
      throw new Error(`GraphFetchMock: no queued response left for ${call.method} ${call.url}`);
    }
    return responder(call);
  });
}

function bufferFrom(body: unknown): ArrayBuffer {
  const json = JSON.stringify(body);
  return new TextEncoder().encode(json).buffer as ArrayBuffer;
}

/** Builds a fake `Response` carrying a JSON body -- sufficient for every code path in ms-graph-storage.ts/
 * graph-auth.ts, which only ever calls `.ok`, `.status`, `.statusText`, `.json()`, `.text()`, or
 * `.arrayBuffer()` on a Response. */
export function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => bufferFrom(body),
  } as unknown as Response;
}

/** A response with no body at all (e.g. a successful DELETE). */
export function emptyResponse(status: number, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => {
      throw new Error("no body");
    },
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

export function notFoundResponse(): Response {
  return jsonResponse(404, { error: { code: "itemNotFound", message: "The resource could not be found." } }, "Not Found");
}

export function tokenResponse(accessToken = "test-access-token", expiresInSeconds = 3600): Response {
  return jsonResponse(200, { access_token: accessToken, expires_in: expiresInSeconds, token_type: "Bearer" });
}

export interface FakeDriveItemOptions {
  id?: string;
  name?: string;
  webUrl?: string;
  size?: number;
  driveId?: string;
}

/** A minimal Graph driveItem shape -- exactly the fields ms-graph-storage.ts reads. */
export function fakeDriveItem(options: FakeDriveItemOptions = {}): Record<string, unknown> {
  const name = options.name ?? "item";
  return {
    id: options.id ?? "item-id-1",
    name,
    webUrl: options.webUrl ?? `https://contoso.sharepoint.com/sites/AVInspectionTours/${encodeURIComponent(name)}`,
    size: options.size,
    parentReference: options.driveId ? { driveId: options.driveId } : undefined,
  };
}
