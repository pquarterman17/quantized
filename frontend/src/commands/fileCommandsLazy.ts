// The rarely-used Origin-export command bodies, split out of
// fileCommands.ts (bundle-size ratchet — scripts/check-bundle-size.mjs) and
// lazily imported on click. "Send to Origin (COM)" is a Windows-only,
// feature-flagged path most sessions never touch (CLAUDE.md's "Optional
// Origin (COM)" note); "Export Origin (.ogs)" and "Export consolidated CSV"
// are occasional bulk-export actions.
//
// "Export XRD CSV…"/"Export HDF5…" joined this module for the SAME bundle
// reason (PRIMARY_SOFTWARE_AUDIT_PLAN P3.4's safe-cancel-for-export work):
// wiring their cancel affordance through lib/exportActive.ts grew that
// shared module past the point fileCommands.ts's own eager import of it
// could still afford. Moving these two bodies here — the exact "reductions
// first" move the ratchet's own review process asks for before any pin
// raise — took `exportActive` itself off fileCommands.ts's eager import
// list entirely (every remaining eager caller of it was already gone), so
// the module and its P3.4 growth are lazy-only now, like every other export
// body in this file.
//
// The actual `lib/api.ts` calls stay imported EAGERLY in fileCommands.ts and
// are passed in as parameters, rather than re-imported here — api.ts is
// already reachable synchronously elsewhere (store/useApp.ts's
// fftSpectral/fitModel/peaksIntegrate/uploadFile), and MEASURING (never
// guessing, per CLAUDE.md) showed that importing even a few of its OTHER
// exports from this lazy module forces Rollup to extract api.ts (plus its
// lib/http.ts dependency) into a new shared chunk that — because it is
// STILL reachable synchronously — gets modulepreloaded (i.e. counted as
// eager) anyway, on top of real chunk-boundary overhead: a same-environment
// A/B build measured that approach as a net INCREASE in eager bytes (roughly
// +0.2 kB), not the intended decrease. Accepting the functions as
// parameters keeps api.ts's reachability graph byte-identical to the
// pre-split baseline, so only the actual body logic (try/catch, the
// Origin-graph object literal, resolveDatasets/toast calls) leaves the
// eager bundle.

import { exportActive, type StoreGet } from "../lib/exportActive";
import { toast } from "../store/toasts";
import type {
  exportConsolidated,
  exportHdf5,
  exportOrigin,
  exportXrdCsv,
  originComStatus,
  sendToOrigin,
} from "../lib/api";

export async function runExportXrdCsv(s: StoreGet, exportXrdCsvFn: typeof exportXrdCsv): Promise<void> {
  await exportActive(s, (stem, ds, signal) => exportXrdCsvFn({ dataset: ds.data, filename: stem }, signal));
}

export async function runExportHdf5(s: StoreGet, exportHdf5Fn: typeof exportHdf5): Promise<void> {
  await exportActive(s, (stem, ds, signal) =>
    exportHdf5Fn(
      ds.raw ? { dataset: ds.raw, corrected: ds.data, filename: stem } : { dataset: ds.data, filename: stem },
      signal,
    ),
  );
}

export async function runSendToOrigin(
  s: StoreGet,
  originComStatusFn: typeof originComStatus,
  sendToOriginFn: typeof sendToOrigin,
): Promise<void> {
  // Selected datasets when a multi-selection exists, else the active one.
  const all = s().datasets;
  const sel = all.filter((d) => s().selectedIds.includes(d.id));
  const targets = sel.length > 0 ? sel : all.filter((d) => d.id === s().activeId);
  if (targets.length === 0) {
    s().setStatus("no dataset to send");
    toast("no dataset to send", "danger");
    return;
  }
  try {
    const { available } = await originComStatusFn();
    if (!available) {
      const msg =
        "Origin COM unavailable (needs Windows + QZ_ORIGIN_COM=1 + a running Origin) — use Export Origin (.ogs) instead";
      s().setStatus(msg);
      toast(msg, "danger");
      return;
    }
    // #38 deferred edge: a multi-selection can include datasets never
    // activated/rendered — resolve every target's full data first (bounded
    // concurrency) rather than silently sending previews.
    const resolved = await s().resolveDatasets(targets.map((d) => d.id));
    const r = await sendToOriginFn({
      datasets: resolved.map((d) => ({
        dataset: d.data,
        name: d.name.replace(/\.[^.]+$/, ""),
      })),
    });
    const msg = `sent to Origin: ${r.books.join(", ")}`;
    s().setStatus(msg);
    toast(msg, "ok");
  } catch (e: unknown) {
    const msg = `send failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}

export async function runExportOrigin(s: StoreGet, exportOriginFn: typeof exportOrigin): Promise<void> {
  await exportActive(s, (stem, ds, signal) =>
    exportOriginFn(
      {
        dataset: ds.data,
        filename: stem,
        log_x: s().xScale === "log", // Origin's own axis type is boolean-only
        log_y: s().yScale === "log",
        // Current plot state -> an Origin GRAPH, not just the workbook (item 26).
        graph: {
          y_keys: s().yKeys,
          x_key: s().xKey,
          x_log: s().xScale === "log",
          y_log: s().yScale === "log",
          x_lim: s().xLim,
          y_lim: s().yLim,
          y2_keys: s().y2Keys ?? [],
        },
      },
      signal,
    ),
  );
}

export async function runExportConsolidated(
  s: StoreGet,
  exportConsolidatedFn: typeof exportConsolidated,
): Promise<void> {
  const all = s().datasets;
  if (all.length === 0) {
    s().setStatus("no datasets to consolidate");
    return;
  }
  try {
    // #38 deferred edge: consolidate touches EVERY loaded dataset, including
    // ones never activated/rendered — resolve them all first (bounded
    // concurrency) rather than silently exporting previews.
    const resolved = await s().resolveDatasets(all.map((d) => d.id));
    await exportConsolidatedFn({
      datasets: resolved.map((d) => ({ dataset: d.data, name: d.name })),
    });
  } catch (e: unknown) {
    s().setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`);
  }
}
