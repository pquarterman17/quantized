import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteImportFilter, importGuess, importParse, importPreview, listImportFilters, saveImportFilter } from "../../../lib/api/importFilters";
import type {
  DataStruct,
  ImportFilterWire,
  ImportPreviewResponse,
  ImportSettingsWire,
} from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useImportWizard } from "./useImportWizard";

vi.mock("../../../lib/api/importFilters", () => ({
  importGuess: vi.fn(),
  importPreview: vi.fn(),
  importParse: vi.fn(),
  listImportFilters: vi.fn(),
  saveImportFilter: vi.fn(),
  deleteImportFilter: vi.fn(),
}));

const SETTINGS: ImportSettingsWire = {
  delimiter: "auto",
  header_line: 1,
  units_line: 2,
  label_line: null,
  data_start_line: 3,
  column_names: ["Temp", "Moment"],
  roles: ["x", "y"],
};

const PREVIEW: ImportPreviewResponse = {
  raw_lines: ["# header comment", "Temp,Moment", "(K),(emu)", "300,0.0012"],
  n_lines: 4,
  delimiter: ",",
  header_line: 1,
  units_line: 2,
  label_line: null,
  data_start_line: 3,
  columns: [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "Moment", unit: "emu", role: "y" },
  ],
  rows: [[300, 0.0012]],
  n_data_rows: 1,
  n_preview_rows: 1,
  comments: [],
};

const DS: DataStruct = {
  time: [300],
  values: [[0.0012]],
  labels: ["Moment"],
  units: ["emu"],
  metadata: {},
};

const fakeFile = (name: string, text = "# header comment\nTemp,Moment\n(K),(emu)\n300,0.0012\n") =>
  new File([text], name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listImportFilters).mockResolvedValue([]);
  vi.mocked(importGuess).mockResolvedValue(SETTINGS);
  vi.mocked(importPreview).mockResolvedValue(PREVIEW);
  useApp.setState({ datasets: [], activeId: null, status: "", recent: [] });
});

describe("useImportWizard", () => {
  it("loads saved filters on mount", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));
  });

  it("reads the picked file, guesses starting settings, and previews", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    expect(importGuess).toHaveBeenCalledWith(expect.stringContaining("Temp,Moment"));
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));
    expect(importPreview).toHaveBeenCalledWith(expect.any(String), SETTINGS, 30);
    expect(result.current.file?.name).toBe("run1.dat");
  });

  it("re-previews (debounced) when a setting is patched", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));
    vi.mocked(importPreview).mockClear();

    act(() => result.current.patchSettings({ data_start_line: 5 }));
    await waitFor(() =>
      expect(importPreview).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ data_start_line: 5 }),
        30,
      ),
    );
  });

  it("edits a column's role/name/unit through the aligned-array helpers", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    act(() => result.current.setColumnRole(1, "error"));
    expect(result.current.settings?.roles).toEqual(["x", "error"]);

    act(() => result.current.setColumnName(0, "Temperature"));
    expect(result.current.settings?.column_names).toEqual(["Temperature (K)", "Moment (emu)"]);

    act(() => result.current.setColumnUnit(1, "mA·m²"));
    expect(result.current.settings?.column_names).toEqual([
      "Temperature (K)",
      "Moment (mA·m²)",
    ]);
  });

  it("imports the confirmed settings into a new library dataset named after the file", async () => {
    vi.mocked(importParse).mockResolvedValue(DS);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    await act(async () => {
      await result.current.doImport();
    });

    expect(importParse).toHaveBeenCalledWith(expect.any(String), SETTINGS);
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(1);
    expect(ds[0].name).toBe("run1.dat");
    expect(ds[0].data).toEqual(DS);
    expect(result.current.imported).toBe(true);
  });

  it("P1.6 item 2: attaches CONFIRMED error-role bindings (from the auto-suggestion) to the new dataset", async () => {
    const errPreview: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "K", role: "x" },
        { index: 1, name: "R", unit: "", role: "y" },
        { index: 2, name: "dR", unit: "", role: "error" },
      ],
    };
    vi.mocked(importPreview).mockResolvedValue(errPreview);
    vi.mocked(importParse).mockResolvedValue(DS);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.errorRows).toEqual([
      { channel: 1, label: "dR", target: 0, axis: "y", side: "both", provenance: "suggested", preferredAxis: null },
    ]));

    await act(async () => {
      await result.current.doImport();
    });

    const ds = useApp.getState().datasets;
    expect(ds[0].errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("P1.6 item 2: an UNASSIGNED error row never reaches Dataset.errorRoles — never a guessed default", async () => {
    const ambiguous: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        { index: 0, name: "err", unit: "", role: "error" }, // nothing precedes it — genuinely ambiguous
        { index: 1, name: "M", unit: "", role: "y" },
      ],
    };
    vi.mocked(importPreview).mockResolvedValue(ambiguous);
    vi.mocked(importParse).mockResolvedValue(DS);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.errorRows).toEqual([
      { channel: 0, label: "err", target: null, axis: "y", side: "both", provenance: "unassigned", preferredAxis: null },
    ]));

    await act(async () => {
      await result.current.doImport();
    });

    const ds = useApp.getState().datasets;
    expect(ds[0].errorRoles).toBeUndefined();
  });

  it("P1.6 review P1-1: a MULTI-CANDIDATE position-only suggestion (T1, 'T err', T2) seeds unassigned and never reaches Dataset.errorRoles unconfirmed", async () => {
    const multiCandidate: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        { index: 0, name: "T1", unit: "", role: "y" },
        { index: 1, name: "T err", unit: "", role: "error" },
        { index: 2, name: "T2", unit: "", role: "y" },
      ],
    };
    vi.mocked(importPreview).mockResolvedValue(multiCandidate);
    vi.mocked(importParse).mockResolvedValue(DS);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.errorRows).toEqual([
      { channel: 1, label: "T err", target: null, axis: "y", side: "both", provenance: "unassigned", preferredAxis: null },
    ]));

    await act(async () => {
      await result.current.doImport();
    });

    expect(useApp.getState().datasets[0].errorRoles).toBeUndefined();
  });

  it("surfaces a parse error (422) without adding a dataset", async () => {
    vi.mocked(importParse).mockRejectedValue(new Error("no y/error columns selected to import"));
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    await act(async () => {
      await result.current.doImport();
    });

    expect(result.current.error).toContain("no y/error columns");
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("saves the confirmed settings as a named filter", async () => {
    const saved: ImportFilterWire = { name: "Messy XYZ", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(saveImportFilter).mockResolvedValue(saved);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    await act(async () => {
      await result.current.saveAsFilter("Messy XYZ", "*.dat");
    });

    expect(saveImportFilter).toHaveBeenCalledWith("Messy XYZ", "*.dat", SETTINGS);
    expect(result.current.filters).toContainEqual(saved);
  });

  it("applies a saved filter's settings (and re-previews under them)", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    vi.mocked(importGuess).mockResolvedValue({ ...SETTINGS, delimiter: "auto", roles: ["y", "y"] });
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.applyFilter("Messy");
    });
    expect(result.current.settings).toEqual(SETTINGS);
    expect(result.current.preview).toEqual(PREVIEW);
  });

  it("applying a filter clears prior editor overrides and shows the filter binding", async () => {
    const binding = { column: 2, target: -1, axis: "x" as const, side: "both" as const };
    const filterSettings: ImportSettingsWire = {
      ...SETTINGS,
      column_names: ["Temp", "Moment", "dMoment"],
      roles: ["x", "y", "error"],
      error_bindings: [binding],
    };
    const filt: ImportFilterWire = { name: "With errors", glob: "*.dat", settings: filterSettings, updated: "t" };
    const errorPreview: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        ...PREVIEW.columns,
        { index: 2, name: "dMoment", unit: "", role: "error" },
      ],
      error_bindings: [binding],
    };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    vi.mocked(importPreview).mockResolvedValue(errorPreview);
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await waitFor(() => expect(result.current.errorRows[0]?.target).toBe(-1));
    act(() => result.current.setErrorTarget(1, null));
    expect(result.current.errorRows[0].target).toBeNull();

    await act(async () => { await result.current.applyFilter("With errors"); });
    await waitFor(() => expect(result.current.errorRows[0]?.target).toBe(-1));
    expect(result.current.settings?.error_bindings).toEqual([binding]);
  });

  it("does not repopulate a filter that explicitly saved no error bindings", async () => {
    const filterSettings: ImportSettingsWire = {
      ...SETTINGS,
      column_names: ["Temp", "Moment", "dMoment"],
      roles: ["x", "y", "error"],
      error_bindings: [],
    };
    const filt: ImportFilterWire = { name: "No errors", glob: "*.dat", settings: filterSettings, updated: "t" };
    const errorPreview: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [...PREVIEW.columns, { index: 2, name: "dMoment", unit: "", role: "error" }],
      error_bindings: [],
      suggested_error_bindings: [{ column: 2, target: 1, axis: "y", side: "both" }],
    };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    vi.mocked(importPreview).mockResolvedValue(errorPreview);
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await act(async () => { await result.current.applyFilter("No errors"); });
    await waitFor(() => expect(result.current.errorRows[0]?.target).toBeNull());
    expect(result.current.settings?.error_bindings).toEqual([]);
  });

  it("preserves an explicitly horizontal axis when repointing between signal targets", async () => {
    const wide: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "", role: "x" },
        { index: 1, name: "A", unit: "", role: "y" },
        { index: 2, name: "dA", unit: "", role: "error" },
        { index: 3, name: "B", unit: "", role: "y" },
      ],
    };
    vi.mocked(importPreview).mockResolvedValue(wide);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await waitFor(() => expect(result.current.errorRows[0]?.target).not.toBeNull());
    await waitFor(() => expect(result.current.settings?.error_bindings).toHaveLength(1));
    act(() => result.current.setErrorAxis(1, "x"));
    expect(result.current.errorRows[0]).toMatchObject({ axis: "x", preferredAxis: "x" });
    act(() => result.current.setErrorTarget(1, 2));
    expect(result.current.errorRows[0].axis).toBe("x");
    expect(result.current.settings?.error_bindings).toContainEqual({
      column: 2, target: 3, axis: "x", side: "both",
    });
  });

  it("removes a malformed saved binding even when backend placeholders cannot exactly match it", async () => {
    const malformed = [{ column: "2", target: 1, axis: "Y", side: "plus" }] as unknown as NonNullable<ImportSettingsWire["error_bindings"]>;
    vi.mocked(importGuess).mockResolvedValue({ ...SETTINGS, error_bindings: malformed });
    const { result } = renderHook(() => useImportWizard());
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    act(() => result.current.removeRejectedErrorBinding({
      column: -1, target: 1, axis: "Y", side: "plus", code: "malformed_entry", reason: "Malformed binding",
    }));
    expect(result.current.settings?.error_bindings).toEqual([]);
  });

  it("refuses to apply a saved filter whose column shape no longer matches, leaving current settings untouched (P1.6 item 4)", async () => {
    const stale: ImportFilterWire = {
      name: "Stale",
      glob: "*.dat",
      settings: { ...SETTINGS, column_names: ["Field", "Moment"] }, // "Field" no longer matches
      updated: "t",
    };
    vi.mocked(listImportFilters).mockResolvedValue([stale]);
    vi.mocked(importGuess).mockResolvedValue({ ...SETTINGS, delimiter: "auto", roles: ["y", "y"] });
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([stale]));
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    const settingsBefore = result.current.settings;

    await act(async () => {
      await result.current.applyFilter("Stale");
    });
    expect(result.current.settings).toEqual(settingsBefore); // never partially applied
  });

  it("P1.6 review P1-2: refuses a filter whose saved label_line lands on real data in THIS file, leaving settings untouched", async () => {
    // fileB naturally starts data at line 1 (no extra label row) -- fileA's
    // saved filter expects a label row at line 1 and data starting at 2.
    vi.mocked(importGuess).mockResolvedValue({
      ...SETTINGS,
      header_line: 0,
      units_line: null,
      label_line: null,
      data_start_line: 1,
      roles: ["x", "y"],
    });
    const fileAFilter: ImportFilterWire = {
      name: "FileA shape",
      glob: "*.dat",
      settings: {
        ...SETTINGS,
        header_line: 0,
        units_line: null,
        label_line: 1,
        data_start_line: 2,
        column_names: null,
        roles: ["x", "y"],
      },
      updated: "t",
    };
    vi.mocked(listImportFilters).mockResolvedValue([fileAFilter]);
    vi.mocked(importPreview).mockResolvedValue({
      ...PREVIEW,
      raw_lines: ["Temp,Moment", "1,10", "2,20"],
      header_line: 0,
      units_line: null,
      label_line: 1,
      data_start_line: 2,
    });
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([fileAFilter]));
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    const settingsBefore = result.current.settings;

    await act(async () => {
      await result.current.applyFilter("FileA shape");
    });
    expect(result.current.settings).toEqual(settingsBefore); // never partially applied
  });

  it("P1-5 DEFECT 1: surfaces a conflict message and refuses to import when more than one column is marked x", async () => {
    const multiX: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "K", role: "x" },
        { index: 1, name: "Field", unit: "Oe", role: "x" },
      ],
    };
    vi.mocked(importPreview).mockResolvedValue(multiX);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(multiX));

    expect(result.current.xConflict).not.toBeNull();
    expect(result.current.xConflict).toContain("Temp");
    expect(result.current.xConflict).toContain("Field");

    // Defense in depth: doImport must not call the backend at all while a
    // conflict is outstanding (the panel disables the button, but the hook
    // itself must also refuse).
    await act(async () => {
      await result.current.doImport();
    });
    expect(importParse).not.toHaveBeenCalled();
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(0);
  });

  it("P1-5 DEFECT 1: xConflict clears once only one column is marked x again", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));
    expect(result.current.xConflict).toBeNull();
  });

  it("removes a saved filter", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));

    await act(async () => {
      await result.current.removeFilter("Messy");
    });

    expect(deleteImportFilter).toHaveBeenCalledWith("Messy");
    expect(result.current.filters).toEqual([]);
  });
  // ── Review round 4 regressions (error-binding / editor-row agreement) ──────

  it("applies a suggestion even when suggestions are suppressed by an explicit saved binding set", async () => {
    // A file opened through a saved filter that recorded "no error bindings"
    // suppresses seeding, so the row for a newly re-roled column starts
    // UNASSIGNED. Writing only settings made Apply a no-op: the reconciliation
    // effect, for which the row is authoritative, pruned the binding straight
    // back out one render later.
    const suggestion = { column: 2, target: 1, axis: "y" as const, side: "both" as const };
    vi.mocked(importGuess).mockResolvedValue({
      ...SETTINGS,
      column_names: ["Temp", "Moment", "dMoment"],
      roles: ["x", "y", "y"],
      error_bindings: [],
    });
    vi.mocked(importPreview).mockResolvedValue({
      ...PREVIEW,
      columns: [...PREVIEW.columns, { index: 2, name: "dMoment", unit: "", role: "y" }],
      error_bindings: [],
      suggested_error_bindings: [suggestion],
    });
    const { result } = renderHook(() => useImportWizard());
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await waitFor(() => expect(result.current.preview?.columns).toHaveLength(3));

    await act(async () => { result.current.applyErrorSuggestion(suggestion); });

    expect(result.current.settings?.error_bindings).toEqual([suggestion]);
    expect(result.current.errorRows).toHaveLength(1);
    expect(result.current.errorRows[0]).toMatchObject({ channel: 1, target: 0, axis: "y", side: "both" });
  });

  it("keeps a backend-REJECTED binding in settings until the user dismisses its alert", async () => {
    // The column exists and IS an error column, so the row-authoritative
    // reconciliation would happily overwrite/prune it -- deleting the evidence
    // behind a visible "Remove invalid setting" alert, and silently discarding
    // a saved pairing the user never acknowledged.
    const rejected = { column: 2, target: 1, axis: "x" as const, side: "both" as const };
    vi.mocked(importGuess).mockResolvedValue({
      ...SETTINGS,
      column_names: ["Temp", "Moment", "dMoment"],
      roles: ["x", "y", "error"],
      error_bindings: [rejected],
    });
    vi.mocked(importPreview).mockResolvedValue({
      ...PREVIEW,
      columns: [...PREVIEW.columns, { index: 2, name: "dMoment", unit: "", role: "error" }],
      error_bindings: [],
      error_binding_problems: [{
        ...rejected,
        code: "axis_contradicts_target",
        reason: "x-axis error must target the x axis.",
      }],
    });
    const { result } = renderHook(() => useImportWizard());
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await waitFor(() => expect(result.current.preview?.error_binding_problems).toHaveLength(1));

    expect(result.current.settings?.error_bindings).toEqual([rejected]);

    const problem = result.current.preview!.error_binding_problems![0];
    await act(async () => { result.current.removeRejectedErrorBinding(problem); });
    expect(result.current.settings?.error_bindings).toEqual([]);
  });

  it("never writes a binding against stale channel numbering when a preceding column is re-roled", async () => {
    // Re-roling `A` (y -> ignore) renumbers every channel after it while the
    // ERROR-column COUNT stays equal, so a count-only staleness guard let the
    // stale rows be written against the new numbering -- persisting plain `B`
    // as an error column for `dA`. It self-corrects on the next commit, but
    // `settings` is read synchronously by doImport/saveAsFilter, so the
    // assertion is over EVERY rendered value, not just the settled one.
    const wide: ImportPreviewResponse = {
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "", role: "x" },
        { index: 1, name: "A", unit: "", role: "y" },
        { index: 2, name: "dA", unit: "", role: "error" },
        { index: 3, name: "B", unit: "", role: "y" },
      ],
    };
    vi.mocked(importPreview).mockResolvedValue(wide);
    const seen: (ImportSettingsWire["error_bindings"])[] = [];
    const { result } = renderHook(() => {
      const state = useImportWizard();
      seen.push(state.settings?.error_bindings);
      return state;
    });
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await waitFor(() => expect(result.current.settings?.error_bindings).toHaveLength(1));

    await act(async () => { result.current.setColumnRole(1, "ignore"); });

    for (const bindings of seen) {
      // column 3 is `B`, a plain y column -- it must never appear as the
      // ERROR column of a binding, in any intermediate render.
      expect(bindings?.some((b) => b.column === 3) ?? false).toBe(false);
    }
  });

  it("removes the CLICKED malformed binding, not merely the first shape-invalid one", async () => {
    const malformed = [
      { column: "2", target: 1, axis: "y", side: "both" },
      { column: 3, target: 1, axis: "Y", side: "both" },
    ] as unknown as NonNullable<ImportSettingsWire["error_bindings"]>;
    vi.mocked(importGuess).mockResolvedValue({ ...SETTINGS, error_bindings: malformed });
    vi.mocked(importPreview).mockResolvedValue({
      ...PREVIEW,
      error_binding_problems: [
        { column: -1, target: 1, axis: "y", side: "both", code: "malformed_entry", reason: "Entry 1 is malformed." },
        { column: 3, target: 1, axis: "y", side: "both", code: "malformed_entry", reason: "Entry 2 is malformed." },
      ],
    });
    const { result } = renderHook(() => useImportWizard());
    await act(async () => { await result.current.pickFile(fakeFile("run1.dat")); });
    await waitFor(() => expect(result.current.preview?.error_binding_problems).toHaveLength(2));

    const second = result.current.preview!.error_binding_problems![1];
    await act(async () => { result.current.removeRejectedErrorBinding(second); });

    expect(result.current.settings?.error_bindings).toEqual([malformed[0]]);
  });
});
