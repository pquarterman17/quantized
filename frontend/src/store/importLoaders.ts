// Per-item loaders for the import slice (store/importDatasets.ts): how ONE
// picked File or ONE filesystem path is fetched and parsed. Split out of
// importDatasets.ts so the batch loop there stays about batching.
//
// Two kinds of result:
//   - a DataStruct payload (every data format) for the Library, and
//   - a crystal STRUCTURE (.cif): a unit cell + atom sites with no sampled
//     axis, so never a DataStruct (backend io/registry.py refuses .cif on the
//     dataset path). It goes to /api/structures/* and lands as a lattice
//     preset for the XRD tools (store/crystalStructures, lib/crystalStructure).
// Routing is by extension, mirroring the backend registry's one decision.

import { importFile, uploadFile } from "../lib/api";
import { importStructurePath, uploadStructure, type CrystalStructure } from "../lib/api/structures";
import { structureFileName } from "../lib/crystalStructure";
import { probeSource } from "../lib/desktopBridge";
import type { DataStruct, Dataset } from "../lib/types";
import { plural } from "../lib/plural";
import { presetLabel, useCrystalStructures, type StructurePreset } from "./crystalStructures";
import { toast } from "./toasts";

/** Where one imported payload came from — the only thing the two entry points
 *  disagree about. */
export interface ImportOrigin {
  /** Display name (a file's name, or a path's basename). */
  name: string;
  /** Bytes, for the Recent list's tooltip; 0 when unknown (a path import does
   *  not stat the file, and a wrong number would be worse than none). */
  size: number;
  /** Set ONLY for a path import — see `Dataset.source`'s doc for the full
   *  "where a path is/isn't knowable" matrix, including the P1.7
   *  checksum/mtime/size provenance fields threaded through from
   *  `loadPath`'s `probeSource` call below. */
  source?: Dataset["source"];
}

export type ImportLoad = { data: DataStruct; origin: ImportOrigin } | { structure: StructurePreset };

/** Basename without directory — the display name for a path import. */
export function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

const addStructure = (s: CrystalStructure): StructurePreset => useCrystalStructures.getState().addStructure(s);

/** A picked / dropped File (`/upload`: bytes; the browser never knows a path). */
export async function loadUpload(file: File, signal: AbortSignal): Promise<ImportLoad> {
  if (structureFileName(file.name)) return { structure: addStructure(await uploadStructure(file, signal)) };
  return { data: await uploadFile(file, signal), origin: { name: file.name, size: file.size } };
}

/** A real filesystem path (the native dialog, Recent files, relink). */
export async function loadPath(path: string, signal: AbortSignal): Promise<ImportLoad> {
  if (structureFileName(path)) return { structure: addStructure(await importStructurePath(path, signal)) };
  const data = await importFile(path, signal);
  // P1.7 / L0.32 provenance: "record source path, import time,
  // observed modification time, and a checksum where practical".
  // `probeSource` returns null with no bridge (a browser tab, or a
  // test with no mock) — degrades to path-only provenance rather
  // than failing the import; a native pick already granted this
  // exact path read consent moments ago (lib/importEntry.ts's
  // `chooseAndImport` -> `pick_files`), so the checksum is real
  // whenever a bridge is present at all.
  const probe = await probeSource(path);
  const source: Dataset["source"] =
    probe?.state === "ok"
      ? {
          kind: "path",
          path,
          ...(probe.checksum != null ? { checksum: probe.checksum } : {}),
          ...(probe.mtime != null ? { mtime: probe.mtime } : {}),
          ...(probe.size != null ? { size: probe.size } : {}),
        }
      : { kind: "path", path };
  // The path is what makes this import re-importable without a picker.
  return { data, origin: { name: pathBasename(path), size: probe?.size ?? 0, source } };
}

/** The batch's word on the structures it added: where to use them. */
export function presentStructures(added: readonly StructurePreset[]): void {
  const names = added.map(presetLabel).join("; ");
  toast(`Added lattice preset${plural(added.length)} ${names}: use in Reductions → Pawley or Calculators → Crystal.`, "info");
}
