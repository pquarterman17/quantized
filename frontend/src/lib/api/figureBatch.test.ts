import { afterEach, describe, expect, it, vi } from "vitest";

import { exportFigureBatch } from "./figureBatch";

afterEach(() => vi.unstubAllGlobals());

function rejectWith(status: number, detail: string): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ detail }),
    { status, statusText: detail, headers: { "Content-Type": "application/json" } },
  )));
}

describe("exportFigureBatch", () => {
  it("turns the generic body-limit response into actionable batch guidance", async () => {
    rejectWith(413, "request body too large");
    await expect(exportFigureBatch([], "figures")).rejects.toThrow(
      "Export fewer figures or split it into smaller archives",
    );
  });

  it("does not hide unrelated transport failures", async () => {
    rejectWith(500, "renderer unavailable");
    await expect(exportFigureBatch([], "figures")).rejects.toThrow("renderer unavailable");
  });
});
