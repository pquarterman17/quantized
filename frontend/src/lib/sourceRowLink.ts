// A materialised subset's link back to its source rows (ROW_RANGE_CONTRACT section 4, decision D5). Pure:
// no store, no React.
//
// Extract and "Create subset from region" copy rows into a new worksheet. The copy keeps the source's ROW
// IDENTITIES, not positions: the source gets an opaque token per extracted row (its `FIT_ROW_IDENTITIES`
// sidecar, which follows every row operation), and the child records, per child row, the token of the source
// row it came from (`SOURCE_ROWS_KEY`, sliced with the child's own rows). Go to Source resolves the tokens to
// the source's CURRENT positions, so it is right after the source was sorted, grown or shrunk.
//
// FAIL CLOSED. A token the source no longer holds is a row that is gone (deleted, or the identities were lost
// with a re-import): it is counted and said, never replaced by a row at the same position. The tokens are
// random (`mintRowId`), so a source that lost its identities and minted new ones cannot make an old link name
// a different row. A malformed record reads as "no link".

import { fitRowIdentities, installRowIdentities } from "./fitRowIdentity";
import { SOURCE_ROWS_KEY } from "./rowSidecars";
import type { Dataset, DataStruct } from "./types";

/** More linked rows than this and the subset is unlinked at row level (decision D6): one token is about 25
 *  bytes in the source and again in the child, in the `.dwk`. */
export const SOURCE_LINK_CAP = 100_000;

export interface SourceRowLink {
  /** The source worksheet's id. */
  source: string;
  /** Child row (as text, like every sparse sidecar) to the source row's identity. */
  rows: Record<string, string>;
}

const TOKEN = /^r1:[0-9a-z]{1,10}$/;

/** `metadata`'s link, or null when there is none or it is anything but a source id and well-formed tokens. */
export function readSourceRowLink(metadata: Readonly<Record<string, unknown>> | undefined): SourceRowLink | null {
  const raw = metadata?.[SOURCE_ROWS_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { source, rows } = raw as Record<string, unknown>;
  if (typeof source !== "string" || !source || typeof rows !== "object" || rows === null || Array.isArray(rows)) return null;
  const out: Record<string, string> = {};
  for (const [row, token] of Object.entries(rows)) {
    if (!/^\d+$/.test(row) || typeof token !== "string" || !TOKEN.test(token)) return null;
    out[row] = token;
  }
  return Object.keys(out).length ? { source, rows: out } : null;
}

/** The source id a worksheet's row link names, WITHOUT validating its tokens (a subset can hold 100,000 of them):
 *  for a menu that only needs to know whether to offer Go to Source. The action validates. */
export function sourceLinkId(metadata: Readonly<Record<string, unknown>> | undefined): string | null {
  const raw = metadata?.[SOURCE_ROWS_KEY];
  const source = typeof raw === "object" && raw !== null ? (raw as { source?: unknown }).source : undefined;
  return typeof source === "string" && source ? source : null;
}

export type SourceLinkPlan =
  | { kind: "linked"; link: SourceRowLink; sourceMetadata: Record<string, unknown> }
  | { kind: "unlinked"; reason: string };

/** The link for a child made of `rows` (source rows, in child order) of `source`, and the source's identity
 *  record with those rows added (to be installed once the child is committed). */
export function planSourceLink(source: Dataset, rows: readonly number[]): SourceLinkPlan {
  if (rows.length > SOURCE_LINK_CAP) {
    return { kind: "unlinked", reason: `row link not kept: more than ${SOURCE_LINK_CAP.toLocaleString()} rows` };
  }
  const bound = installRowIdentities(source.data.metadata, source.data.time.length, rows);
  if (!bound) return { kind: "unlinked", reason: "row link not kept: a row is outside the source" };
  const links: Record<string, string> = {};
  rows.forEach((row, child) => { links[String(child)] = bound.ids.get(row)!; });
  return { kind: "linked", link: { source: source.id, rows: links }, sourceMetadata: bound.metadata };
}

/** `data` carrying `link` (the same object when there is none). */
export function stampSourceLink(data: DataStruct, link: SourceRowLink | null): DataStruct {
  return link ? { ...data, metadata: { ...data.metadata, [SOURCE_ROWS_KEY]: link } } : data;
}

export interface ResolvedSourceRows {
  /** The linked rows' CURRENT source positions, ascending. */
  rows: number[];
  /** How many rows the subset links. */
  linked: number;
  /** How many of those the source no longer holds. */
  missing: number;
}

/** Where the linked rows are in `source` now. */
export function resolveSourceRows(link: SourceRowLink, source: Dataset): ResolvedSourceRows {
  const byToken = new Map<string, number>();
  for (const [row, token] of fitRowIdentities(source.data.metadata, source.data.time.length) ?? []) byToken.set(token, row);
  const tokens = Object.values(link.rows);
  const rows = tokens.flatMap((token) => (byToken.has(token) ? [byToken.get(token)!] : []));
  return { rows: [...new Set(rows)].sort((a, b) => a - b), linked: tokens.length, missing: tokens.length - rows.length };
}

const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** The status line of a Go to Source over `resolved`, in SOURCE row terms (1-based). */
export function goToSourceStatus(resolved: ResolvedSourceRows, sourceName: string): { text: string; tone: "ok" | "danger" } {
  if (!resolved.rows.length) {
    return { text: `Go to Source: none of the ${plural(resolved.linked, "linked row")} exist in “${sourceName}” any more; nothing was selected`, tone: "danger" };
  }
  const gone = resolved.missing > 0 ? `; ${resolved.missing.toLocaleString()} of ${resolved.linked.toLocaleString()} rows no longer exist in the source` : "";
  return { text: `selected ${plural(resolved.rows.length, "row")} of “${sourceName}”${gone}`, tone: resolved.missing > 0 ? "danger" : "ok" };
}
