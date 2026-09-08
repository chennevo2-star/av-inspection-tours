import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalFsStorage } from "../src/local-fs-storage.js";

describe("LocalFsStorage (ADR-007 local dev path)", () => {
  let rootDir: string;
  let storage: LocalFsStorage;

  beforeAll(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "av-inspection-storage-test-"));
    storage = new LocalFsStorage(rootDir, "/api/files");
  });

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("writes a real file to disk and it's readable back byte-for-byte", async () => {
    const body = Buffer.from("fake-jpeg-bytes");
    await storage.put("photos/abc123.jpg", body, "image/jpeg");

    const filePath = storage.resolvePath("photos/abc123.jpg");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath)).toEqual(body);
  });

  it("creates nested directories as needed", async () => {
    await storage.put("audio-chunks/2026-09-08/xyz.webm", Buffer.from("audio"), "audio/webm");
    expect(existsSync(storage.resolvePath("audio-chunks/2026-09-08/xyz.webm"))).toBe(true);
  });

  it("getSignedGetUrl returns a URL under the configured public base", async () => {
    const url = await storage.getSignedGetUrl("photos/abc123.jpg");
    expect(url).toBe("/api/files/photos/abc123.jpg");
  });

  it("delete actually removes the file", async () => {
    await storage.put("to-delete.txt", Buffer.from("bye"), "text/plain");
    const filePath = storage.resolvePath("to-delete.txt");
    expect(existsSync(filePath)).toBe(true);

    await storage.delete("to-delete.txt");
    expect(existsSync(filePath)).toBe(false);
  });

  it("rejects a path-traversal key instead of writing outside rootDir", async () => {
    await expect(storage.put("../../escape.txt", Buffer.from("bad"), "text/plain")).rejects.toThrow(
      /Unsafe object key/
    );
    expect(existsSync(path.join(rootDir, "..", "..", "escape.txt"))).toBe(false);
  });
});
