// Page Setup dialog flow (ORIGIN_FILE_DECODE_PLAN #54 Stage 2): a ParamDialog
// prompt to edit the focused window's page (width / height / unit / margins),
// wired into a one-line palette + menu command in appCommands.ts. Kept out of
// appCommands so that module stays at its size pin. Editing the dimensions
// clears `aspectDerived` — once the user types a real size, the app stops
// calling it aspect-derived.

import { askParams, type ParamField } from "../components/overlays/ParamDialog";
import { defaultPageSetup } from "./pageGeometry";
import { pageSetupFromFields, pageSizeFields } from "./pageSizeFields";
import type { PageSetup } from "./pagesetup";
import type { StoreGet } from "./exportActive";

/** Open the Page Setup dialog for the focused window, seeded from its current
 *  page model (or a neutral default). On confirm, stores the edited page with
 *  `aspectDerived: false`. */
export async function runPageSetupDialog(s: StoreGet): Promise<void> {
  const ps = s().pageSetup ?? defaultPageSetup();
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const dimHint = ps.aspectDerived
    ? "aspect-derived from Origin (no physical size decoded) — set a real page size"
    : `page dimensions, in the selected unit`;
  // Width / height / unit are the Export dialog's fields too (lib/pageSizeFields.ts):
  // one source of truth for the page size, whichever dialog edits it.
  const fields: ParamField[] = [
    ...pageSizeFields(ps, dimHint),
    { key: "mleft", label: "Margin left", type: "number", default: r3(ps.margins.left), hint: "blank border around the figure (its labels always fit inside)" },
    { key: "mright", label: "Margin right", type: "number", default: r3(ps.margins.right) },
    { key: "mtop", label: "Margin top", type: "number", default: r3(ps.margins.top) },
    { key: "mbottom", label: "Margin bottom", type: "number", default: r3(ps.margins.bottom) },
  ];
  const v = await askParams("Page setup", fields);
  if (!v) return;
  const nonneg = (x: unknown) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // The margins are typed in the dialog's (possibly new) unit.
  const sized = pageSetupFromFields(v, ps, defaultPageSetup) ?? ps;
  const next: PageSetup = {
    ...sized,
    margins: {
      left: nonneg(v.mleft),
      right: nonneg(v.mright),
      top: nonneg(v.mtop),
      bottom: nonneg(v.mbottom),
    },
    // The user has confirmed explicit dimensions — no longer aspect-derived.
    aspectDerived: false,
  };
  s().setPageSetup(next);
}
