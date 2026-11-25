// /api/project-search/* -- Find in project, "In folder…" scope (G23;
// src/quantized/routes/project_search.py). Types come from the generated schema.

import { postJSON } from "./http";
import type { components } from "./schema";

export type FolderSearchRequest = components["schemas"]["FolderSearchRequest"];
export type FolderSearchResponse = components["schemas"]["FolderSearchResponse"];
export type FolderFileMatch = components["schemas"]["FileMatchOut"];
export type FolderSearchHit = components["schemas"]["HitOut"];

/** Search a folder of saved projects (.dwk) without opening them. */
export const searchProjectFolder = (folder: string, query: string): Promise<FolderSearchResponse> =>
  postJSON("/api/project-search/folder", { folder, query });
