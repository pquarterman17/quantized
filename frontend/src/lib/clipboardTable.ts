// "Copy as table": the selection on the clipboard as an HTML <table> with a
// plain-text (TSV) fallback, so a paste into Word or PowerPoint keeps the grid
// (rows, columns, a header row) instead of one tab-separated paragraph.
//
// Mirrors lib/officeClipboard.ts (the "Copy Figure" item): ONE `ClipboardItem`
// carrying several flavours, the paste target picking by its own priority, and
// a fallback that degrades to "plain text" rather than "never copies". Unlike
// the figure, the table is built synchronously, so the write starts inside the
// click's user gesture with no pending-promise trick.
//
// Pure builders (`escapeHtml`, `tableToHtml`) plus one capability-guarded
// writer. Lazy-only: the worksheet's block ops are its one caller.

import { clipboardImageSupported, copyText } from "./clipboard";

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A cell that reads as a number is right-aligned, as the grid shows it. */
const NUMERIC = /^[+\-\u2212]?(?:\d[\d.,]*|\.\d+)(?:[eE][+\-]?\d+)?$/;

const TABLE_STYLE = "border-collapse:collapse";
const CELL_STYLE = "border:1px solid #808080;padding:2px 8px";

/** The HTML flavour. `headers` null/empty: no header row. Every cell is
 *  escaped text; the style is inline (Office ignores page stylesheets) and
 *  uses no theme tokens, since the paste target is not this app. A fragment
 *  marker pair wraps the table so Word pastes the table, not a page. */
export function tableToHtml(headers: readonly string[] | null, rows: readonly (readonly string[])[]): string {
  const cell = (tag: "th" | "td", text: string): string => {
    const align = tag === "td" && NUMERIC.test(text.trim()) ? ";text-align:right" : tag === "th" ? ";text-align:left" : "";
    return `<${tag} style="${CELL_STYLE}${align}">${escapeHtml(text)}</${tag}>`;
  };
  const head = headers && headers.length ? `<thead><tr>${headers.map((h) => cell("th", h)).join("")}</tr></thead>` : "";
  const body = rows.map((r) => `<tr>${r.map((c) => cell("td", c)).join("")}</tr>`).join("");
  return `<!doctype html><html><body><!--StartFragment--><table style="${TABLE_STYLE}">${head}<tbody>${body}</tbody></table><!--EndFragment--></body></html>`;
}

/** The plain-text flavour: TSV, with a tab or line break inside a cell turned
 *  into a space so the grid cannot be broken by its own content. */
export function tableToPlain(headers: readonly string[] | null, rows: readonly (readonly string[])[]): string {
  const clean = (t: string) => t.replace(/[\t\r\n]+/g, " ");
  const lines = (headers && headers.length ? [headers, ...rows] : rows).map((r) => r.map(clean).join("\t"));
  return lines.join("\n");
}

export type TableCopyResult = "html" | "text" | false;

/** Write both flavours as one item. "html": both landed. "text": the browser
 *  has no multi-format write (or refused it) and only the plain text was
 *  copied. `false`: nothing was copied. Never throws. */
export async function copyTableAsync(html: string, text: string): Promise<TableCopyResult> {
  if (clipboardImageSupported()) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return "html";
    } catch {
      /* refused: fall through to the plain-text write */
    }
  }
  return (await copyText(text)) ? "text" : false;
}
