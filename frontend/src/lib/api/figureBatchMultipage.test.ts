// Gap-audit-2 #10: batch export as ONE multi-page PDF instead of a ZIP.

import { describe, expect, it, vi } from "vitest";

const postDownload = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./http", async (orig) => ({ ...(await orig<typeof import("./http")>()), postDownload }));

import { exportFigureBatch } from "./figureBatch";
import { downloadBatchFigures } from "../batchFigureExport";

describe("multi-page PDF batch export", () => {
  it("asks for one PDF and saves it as .pdf", async () => {
    await exportFigureBatch([], "Group meeting", undefined, true);
    expect(postDownload).toHaveBeenLastCalledWith("/api/export/figure-batch", { figures: [], filename: "Group meeting", multipage: true }, "Group meeting.pdf", undefined);
  });

  it("a ZIP request is unchanged (no multipage field)", async () => {
    await exportFigureBatch([], "figs");
    expect(postDownload).toHaveBeenLastCalledWith("/api/export/figure-batch", { figures: [], filename: "figs" }, "figs.zip", undefined);
  });

  it("the batch builder's option reaches the request", async () => {
    await downloadBatchFigures([], [], { format: "pdf", style: "default", dpi: 300, archiveName: "set", multipage: true });
    expect(postDownload).toHaveBeenLastCalledWith("/api/export/figure-batch", expect.objectContaining({ multipage: true }), "set.pdf", undefined);
  });
});
