import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}));

import { getQueueThumb } from "./queueThumbs";

describe("getQueueThumb", () => {
  it("returns null for paths with no preview pipeline", async () => {
    expect(await getQueueThumb("C:\\Users\\demo\\notes.txt")).toBeNull();
  });

  it("resolves image files straight to their asset URL", async () => {
    expect(await getQueueThumb("C:\\Users\\demo\\photo.png")).toBe(
      "asset://C:\\Users\\demo\\photo.png"
    );
    expect(await getQueueThumb("C:\\Users\\demo\\photo.JPG")).toBe(
      "asset://C:\\Users\\demo\\photo.JPG"
    );
  });

  it("memoizes the pending result per path", () => {
    const a = getQueueThumb("C:\\Users\\demo\\scan.jpg");
    const b = getQueueThumb("C:\\Users\\demo\\scan.jpg");
    expect(a).toBe(b);
  });
});
