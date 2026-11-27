// One SVG icon set for the plot toolbar (UX audit 10 P2-9). The toolbar used
// Unicode glyphs whose weight, size and even presence depended on the fonts
// installed; these are 16x16 stroke icons in `currentColor`, so they follow the
// button's theme colours. Keyed by the `lib/glyphs` constant each toolbar
// definition already carries, so `plotToolbarDefs` (and the menus that still
// print the glyph as text) are untouched. An unknown glyph falls back to text.

import type { ReactNode } from "react";

import * as G from "../../lib/glyphs";

const P = {
  [G.toolPointer]: <path d="M3.5 2.5l9 4.5-4 1.3-1.3 4z" />,
  [G.toolZoom]: <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5M5.2 7h3.6M7 5.2v3.6" /></>,
  [G.toolPan]: <path d="M8 1.8v12.4M1.8 8h12.4M8 1.8l-1.6 1.6M8 1.8l1.6 1.6M8 14.2l-1.6-1.6M8 14.2l1.6-1.6M1.8 8l1.6-1.6M1.8 8l1.6 1.6M14.2 8l-1.6-1.6M14.2 8l-1.6 1.6" />,
  [G.toolCursor]: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v3.5M8 11v3.5M1.5 8H5M11 8h3.5" /></>,
  [G.toolMeasure]: <path d="M2.5 13.5l11-4M2.5 13.5V3M5.5 13.5a3 3 0 00-.3-1.2M2.5 6.5h1.5M2.5 9.5h1.5" />,
  [G.toolStats]: <path d="M12.5 3.5h-9L8 8l-4.5 4.5h9" />,
  [G.toolSelect]: <path d="M2.5 2.5h3M10.5 2.5h3M13.5 5.5v2M13.5 10.5v3M10.5 13.5h-3M5.5 13.5h-3M2.5 10.5v-3M2.5 5.5v-3" />,
  [G.toolLasso]: <path d="M8 3c3.6 0 6 1.4 6 3.3S11.6 9.6 8 9.6 2 8.2 2 6.3 4.4 3 8 3zM5.5 9.3c-.8 1.5-.4 3 1.2 3.7" />,
  [G.toolPick]: <path d="M8 2.5l5 5.5-5 5.5L3 8zM8 8h.01" />,
  [G.toolIntegrate]: <path d="M10.5 2.5c-1.6-.6-2.5.4-2.5 1.8v7.4c0 1.4-.9 2.4-2.5 1.8" />,
  [G.toolFwhm]: <path d="M1.5 12.5c3 0 3.5-9 6.5-9s3.5 9 6.5 9M4.5 8.5h7" />,
  [G.toolQuickFit]: <path d="M2 11.5c2.5 0 3-6 6-6s3.5 6 6 6" strokeDasharray="2 1.8" />,
  [G.toolRegion]: <path d="M2 8h12M2 5.5v5M14 5.5v5M5 8l-1.5-1.5M5 8L3.5 9.5M11 8l1.5-1.5M11 8l1.5 1.5" />,
  [G.shapeArrow]: <path d="M3 13L13 3M6.5 3H13v6.5" />,
  [G.shapeLine]: <path d="M3 13L13 3" />,
  [G.shapeRect]: <rect x="2.5" y="4" width="11" height="8" rx="1" />,
  [G.shapeEllipse]: <ellipse cx="8" cy="8" rx="5.5" ry="4" />,
  [G.shapeTextbox]: <path d="M3.5 4.5v-1.5h9v1.5M8 3v10M6 13h4" />,
  [G.actionReset]: <path d="M2.5 6V2.5M2.5 2.5H6M2.5 2.5l2 2a5 5 0 11-1 5.5" />,
  [G.actionSmartScale]: <path d="M2.5 13.5V2.5M2.5 13.5h11M5 11c2-.2 3-2 4-4s2-2.5 3-3" />,
  [G.stackedPanels]: <><rect x="2.5" y="2.5" width="11" height="4" rx=".8" /><rect x="2.5" y="9.5" width="11" height="4" rx=".8" /></>,
  [G.actionInset]: <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><rect x="7.5" y="3.5" width="5" height="4" rx=".6" /></>,
  [G.actionPolar]: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.5" /><path d="M8 2.5v11M2.5 8h11" /></>,
  [G.actionStatMode]: <path d="M5 2.5v2M5 9.5v4M3.5 4.5h3v5h-3zM11 4v2M11 11.5v2.5M9.5 6h3v5.5h-3zM9.5 8.5h3M3.5 7h3" />,
  [G.actionSavePng]: <path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M2.5 13.5h11" />,
  [G.actionCopyData]: <><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" /></>,
  [G.actionCopyFigure]: <><rect x="5.5" y="2.5" width="7" height="9" rx="1" /><path d="M3.5 5v7.5a1 1 0 001 1H10" /></>,
  [G.newWindow]: <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M8 5v6M5 8h6" /></>,
  // UX11-C (P2-9 remainder): title-bar + graph-window chrome, keyed by the glyph text those buttons printed.
  "√": <path d="M2 8.5l2 .8 2.4-5.8H14" />,
  "☾": <path d="M12.5 9.6A5.2 5.2 0 016.4 3.5a5.2 5.2 0 106.1 6.1z" />,
  "☀": <><circle cx="8" cy="8" r="2.8" /><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" /></>,
  "▤": <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M6.5 2.5v11" /></>,
  "▥": <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M9.5 2.5v11" /></>,
  "⇄": <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />,
  "●": <circle cx="8" cy="8" r="3.2" fill="currentColor" />,
  "✓": <path d="M3 8.5l3.2 3L13 4.5" />,
  "⧟": <path d="M6.6 9.4l2.8-2.8M7.2 5l1-1a2.5 2.5 0 013.5 3.5l-1 1M8.8 11l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" />,
  "⚲": <path d="M9.8 2.8l3.4 3.4M10.8 3.8L6.2 8.4 4.6 7.4 3.6 8.4l4 4 1-1-1-1.6 4.6-4.6M5 11l-2.5 2.5" />,
  "◐": <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor" /></>,
  "□": <rect x="3" y="3" width="10" height="10" rx="1" />,
  "❐": <path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />,
} as Record<string, ReactNode>;

/** The SVG for a `lib/glyphs` toolbar glyph, or the glyph text if it has none. */
export default function ToolbarIcon({ glyph }: { glyph: string }) {
  const body = P[glyph];
  if (!body) return <>{glyph}</>;
  return (
    <svg className="qzk-tool-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
