// The active view's `errKeys` widened with the active dataset's symmetric-Y
// error roles. The analysis workshops weight and gate on "does this series
// have a Y error?"; reading `errKeys` alone missed a column bound only via
// Inspector > Error columns, though the plot drew its bars (see
// lib/errorRoles `effectiveErrKeys`, the same rule as the series cards).

import { useMemo } from "react";

import { effectiveErrKeys } from "../lib/errorRoles";
import { useApp } from "./useApp";

export function useEffectiveErrKeys(): Record<number, number> {
  const errKeys = useApp((s) => s.errKeys);
  const roles = useApp((s) => s.datasets.find((d) => d.id === s.activeId)?.errorRoles);
  return useMemo(() => effectiveErrKeys(errKeys, roles), [errKeys, roles]);
}
