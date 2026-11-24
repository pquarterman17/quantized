// UX menus audit N1: a registry action that can be disabled must say why
// (its `disabledReason` becomes the menu item's tooltip). Walks the registries
// the lane touched; extend the list as more registries get reasons.

import { describe, expect, it } from "vitest";

import { worksheetRowActions } from "../components/Stage/worksheet/worksheetMenuModel";
import { curveActions } from "./curveContextActions";
import { datasetActions } from "./datasetContextActions";

const registries = { dataset: datasetActions, curve: curveActions, worksheetRow: worksheetRowActions } as const;

describe("disabled menu actions name their reason", () => {
  for (const [name, actions] of Object.entries(registries)) {
    it(`${name} actions with an enabled() gate have a disabledReason`, () => {
      const missing = (actions as readonly { id: string; enabled?: unknown; disabledReason?: unknown }[])
        .filter((a) => a.enabled && !a.disabledReason)
        .map((a) => a.id);
      expect(missing).toEqual([]);
    });
  }
});
