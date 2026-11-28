// Protect / Unprotect a worksheet (lib/sheetProtection.ts): one undo step, one status line. The
// refusals themselves live where each edit path already refuses a re-derived sheet
// (lib/rederivedChecks.ts); this file only flips the flag. Loaded when the Columns menu entry is
// used (a lazy chunk).

import { lit } from "../lib/macro";
import { useApp } from "./useApp";

const get = useApp.getState;

export function setSheetProtected(id: string, on: boolean): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || (ds.protectedSheet === true) === on) return;
  get().recordHistory(on ? "protect sheet" : "unprotect sheet");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      const { protectedSheet: _drop, ...rest } = d;
      return on ? { ...rest, protectedSheet: true } : rest;
    }),
  }));
  get().recordMacro(`${on ? "Protect" : "Unprotect"} sheet ${ds.name}`, (on ? `qz.protectSheet(${lit(ds.name)})` : `qz.unprotectSheet(${lit(ds.name)})`));
  get().setStatus(
    on
      ? `protected "${ds.name}": edits are refused until you unprotect it (Columns > Unprotect sheet); viewing, copying, plotting and analysis still work`
      : `unprotected "${ds.name}"`,
  );
}
