import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDbReadyForTest, ensureDbReady } from "../../lib/server/ensure-db-ready";

beforeEach(__resetDbReadyForTest);

describe("ensureDbReady — real bug: a rejected migration promise used to be cached forever", () => {
  it("memoizes a successful migration -- the underlying migrate function only runs once", async () => {
    const migrate = vi.fn().mockResolvedValue(undefined);

    await ensureDbReady(migrate);
    await ensureDbReady(migrate);
    await ensureDbReady(migrate);

    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failure -- the next call retries instead of repeating the same rejection forever", async () => {
    const migrate = vi.fn().mockRejectedValueOnce(new Error("transient PGlite lock hiccup")).mockResolvedValue(undefined);

    await expect(ensureDbReady(migrate)).rejects.toThrow("transient PGlite lock hiccup");
    // This is exactly the bug that shipped: every /api/sync/* request calls ensureDbReady() with no
    // args, so a real transient failure here used to mean every subsequent call -- for the rest of the
    // server process's life -- replayed the SAME cached rejection, never touching the DB again.
    await expect(ensureDbReady(migrate)).resolves.toBeUndefined();

    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it("clears the cache on every failure, not just the first -- repeated hiccups all get retried, and success still ends up memoized normally", async () => {
    const migrate = vi
      .fn()
      .mockRejectedValueOnce(new Error("first hiccup"))
      .mockRejectedValueOnce(new Error("second hiccup"))
      .mockResolvedValue(undefined);

    await expect(ensureDbReady(migrate)).rejects.toThrow("first hiccup");
    await expect(ensureDbReady(migrate)).rejects.toThrow("second hiccup");
    await expect(ensureDbReady(migrate)).resolves.toBeUndefined();
    // Once it has actually succeeded, later calls must NOT call migrate() again -- that's the entire
    // point of memoizing in the first place (cheap on every request after the real one-time cost).
    await expect(ensureDbReady(migrate)).resolves.toBeUndefined();

    expect(migrate).toHaveBeenCalledTimes(3);
  });
});
