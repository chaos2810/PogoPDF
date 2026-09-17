import { describe, it, expect } from "vitest";
import { getQueueThumb } from "./queueThumbs";

describe("getQueueThumb", () => {
  it("returns null for non-PDF paths (no preview pipeline)", async () => {
    expect(await getQueueThumb("C:\\Users\\demo\\photo.png")).toBeNull();
  });

  it("memoizes the pending result per path", () => {
    const a = getQueueThumb("C:\\Users\\demo\\scan.jpg");
    const b = getQueueThumb("C:\\Users\\demo\\scan.jpg");
    expect(a).toBe(b);
  });
});
