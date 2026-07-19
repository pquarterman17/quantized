// "Export page…" command body for the spatial Origin multi-panel view
// (ORIGIN_FILE_DECODE_PLAN #54 residual): renders the current
// `store.spatialPanels` at their TRUE decoded page coordinates (`pageRect`,
// #54 Stage 2) through the SAME /api/export/figure-page route the Figure
// Page composer uses (lib/figurepage.ts), but assembled straight from the
// decoded layout instead of a user-picked grid. Kept out of appCommands.ts
// (that module's own store-size ratchet, same discipline as
// lib/exportFigureCommand.ts / lib/pageSetupCommand.ts).

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigurePage } from "./api";
import { spatialPanelsOf } from "./composition";
import type { StoreGet } from "./exportActive";
import { buildSpatialPageRequest, canExportSpatialPage } from "./spatialPageExport";
import { toast } from "../store/toasts";
import type { DataStruct } from "./types";

/** Resolve every panel's dataset to full data first (the #38 lazy-book
 *  discipline every other export path follows — a pending preview must
 *  never export small), then build + submit the export request. */
export async function runExportSpatialPageCommand(s: StoreGet): Promise<void> {
  const st = s();
  const panels = spatialPanelsOf(st.composition);
  if (!canExportSpatialPage(panels, st.pageSetup)) {
    const msg = "export page: needs a decoded page and every panel's page position";
    st.setStatus(msg);
    toast(msg, "danger");
    return;
  }
  try {
    const entries = await Promise.all(
      panels!.map(async (p) => {
        const ds = await s().resolveDataset(p.datasetId);
        return ds ? ([p.datasetId, ds.data] as const) : null;
      }),
    );
    const missing = entries.some((e) => e === null);
    const datasets = new Map(
      entries.filter((e): e is readonly [string, DataStruct] => e !== null),
    );
    const live = s();
    const spec = missing
      ? null
      : buildSpatialPageRequest(panels!, datasets, live.pageSetup, {
          xFmt: live.xFmt,
          yFmt: live.yFmt,
          showGrid: live.showGrid,
          showAxisBox: live.showAxisBox,
        });
    if (!spec) {
      const msg = "export page failed: a panel's dataset or page geometry is no longer available";
      s().setStatus(msg);
      toast(msg, "danger");
      return;
    }
    const params = await askParams("Export page", [
      {
        key: "fmt",
        label: "Format",
        type: "select",
        default: "pdf",
        options: ["pdf", "svg", "png", "tiff"],
        hint: "PDF / SVG are vector; PNG / TIFF are raster",
      },
      {
        key: "dpi",
        label: "DPI (raster)",
        type: "number",
        default: 300,
        hint: "Resolution for PNG / TIFF (50-1200); ignored by vector",
      },
    ]);
    if (!params) return;
    const fmt = params.fmt as string;
    await exportFigurePage({ ...spec, fmt, dpi: params.dpi as number, filename: "origin_page" });
    toast(`exported origin_page.${fmt}`, "ok");
  } catch (e: unknown) {
    const msg = `export page failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
