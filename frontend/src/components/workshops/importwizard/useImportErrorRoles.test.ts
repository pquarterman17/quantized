import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ImportPreviewColumn } from "../../../lib/types";
import { useImportErrorRoles } from "./useImportErrorRoles";

const cols = (): ImportPreviewColumn[] => [
  { index: 0, name: "Temp", unit: "K", role: "x" },
  { index: 1, name: "R", unit: "", role: "y" },
  { index: 2, name: "dR", unit: "", role: "error" },
];

describe("useImportErrorRoles", () => {
  it("seeds one row per error-role column with the name-based suggestion", () => {
    const { result } = renderHook(() => useImportErrorRoles(cols()));
    expect(result.current.errorRows).toEqual([
      { channel: 1, label: "dR", target: 0, axis: "y", side: "both" },
    ]);
  });

  it("empty columns yields no rows", () => {
    const { result } = renderHook(() => useImportErrorRoles([]));
    expect(result.current.errorRows).toEqual([]);
  });

  it("setErrorTarget/-Axis/-Side edit one row by channel, leaving others untouched", () => {
    const wide: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "R", unit: "", role: "y" },
      { index: 2, name: "err", unit: "", role: "error" }, // ambiguous — nothing precedes usefully? falls back to R
    ];
    const { result } = renderHook(() => useImportErrorRoles(wide));
    act(() => result.current.setErrorTarget(1, -1));
    expect(result.current.errorRows.find((r) => r.channel === 1)?.target).toBe(-1);
    act(() => result.current.setErrorAxis(1, "x"));
    expect(result.current.errorRows.find((r) => r.channel === 1)?.axis).toBe("x");
    act(() => result.current.setErrorSide(1, "+"));
    expect(result.current.errorRows.find((r) => r.channel === 1)?.side).toBe("+");
  });

  it("a user's explicit edit SURVIVES a re-render that leaves roles/names unchanged (e.g. an unrelated settings tweak)", () => {
    const { result, rerender } = renderHook(({ columns }) => useImportErrorRoles(columns), {
      initialProps: { columns: cols() },
    });
    act(() => result.current.setErrorTarget(1, -1)); // override the suggestion
    expect(result.current.errorRows[0].target).toBe(-1);

    // Re-render with a NEW array reference but the SAME roles/names (as a
    // debounced re-preview after an unrelated edit would produce).
    rerender({ columns: cols() });
    expect(result.current.errorRows[0].target).toBe(-1); // still the user's choice, not re-seeded
  });

  it("reseeds when the role/name arrangement actually changes", () => {
    const { result, rerender } = renderHook(({ columns }) => useImportErrorRoles(columns), {
      initialProps: { columns: cols() },
    });
    act(() => result.current.setErrorTarget(1, -1));
    expect(result.current.errorRows[0].target).toBe(-1);

    // Now the SAME error column is renamed — a real arrangement change.
    const renamed: ImportPreviewColumn[] = [
      { index: 0, name: "Temp", unit: "K", role: "x" },
      { index: 1, name: "R", unit: "", role: "y" },
      { index: 2, name: "dR2", unit: "", role: "error" },
    ];
    rerender({ columns: renamed });
    expect(result.current.errorRows[0].target).toBe(0); // dR2 no longer base-matches -> falls back to nearest preceding (R, channel 0)
  });

  it("resetErrorRows clears state and forces a fresh reseed on the next columns", () => {
    const { result, rerender } = renderHook(({ columns }) => useImportErrorRoles(columns), {
      initialProps: { columns: cols() },
    });
    act(() => result.current.setErrorTarget(1, -1));
    act(() => result.current.resetErrorRows());
    expect(result.current.errorRows).toEqual([]);
    rerender({ columns: cols() });
    expect(result.current.errorRows[0].target).toBe(0); // fresh suggestion, not the cleared override
  });
});
