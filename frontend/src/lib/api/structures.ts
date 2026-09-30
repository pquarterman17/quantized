// Crystal-structure import client (/api/structures/*). A CIF is a crystal
// structure (cell + space group + atom sites), not a DataStruct: the backend
// registry refuses it on the dataset path and parses it here, and the SPA
// keeps it as a lattice preset for the XRD tools (store/crystalStructures).
// Not re-exported by lib/api.ts; only the lazy import chunk reaches it.

import { postForm, postJSON } from "./http";
import type { components } from "./schema";

export type CrystalStructure = components["schemas"]["CrystalStructure"];
export type UnitCell = components["schemas"]["UnitCell"];

/** Parse a picked / dropped .cif file's bytes. */
export function uploadStructure(file: File, signal?: AbortSignal): Promise<CrystalStructure> {
  const form = new FormData();
  form.append("file", file, file.name);
  return postForm<CrystalStructure>("/api/structures/upload", form, signal);
}

/** Parse a server-visible .cif path (the desktop shell's native pick). */
export function importStructurePath(path: string, signal?: AbortSignal): Promise<CrystalStructure> {
  return postJSON<CrystalStructure>("/api/structures/import", { path }, signal);
}
