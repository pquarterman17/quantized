import { applyCorrections } from "../lib/api";
import { remapChannelList, type ColumnShift } from "../lib/channelRemap";
import { recomputeFromBaseOrEmpty } from "../lib/formulaInputs";
import type { Dataset } from "../lib/types";
import { shiftForColumnChange } from "./derivedSheetShift";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

/** Deferred executor for linked worksheet refreshes. Recalculation is an
 * intentional user/debounce action, so its analysis machinery stays out of
 * the startup bundle. */
export async function runDerivedWorksheetRecompute(
  get: SliceGet,
  sheet: Dataset,
): Promise<{ sheet: Dataset; shift: ColumnShift | null }> {
  const sourceId = sheet.derivedFrom?.datasetId;
  const source = sourceId ? get().datasets.find((dataset) => dataset.id === sourceId) : undefined;
  if (!source) throw new Error(`source dataset "${sourceId}" no longer exists`);
  if (source.pending) throw new Error(`source dataset "${source.name}" hasn't fully loaded yet`);
  const assertInputsUnchanged = () => {
    const currentSource = get().datasets.find((dataset) => dataset.id === sourceId);
    const currentSheet = get().datasets.find((dataset) => dataset.id === sheet.id);
    if (currentSource?.data !== source.data || currentSheet !== sheet) {
      throw new Error("source or derived worksheet changed while recalculation was running");
    }
  };
  if (sheet.analysisRecipe) {
    const { recomputeSpectralWorksheet } = await import("./spectralWorksheetsRun");
    const result = await recomputeSpectralWorksheet(source, sheet, sheet.analysisRecipe);
    assertInputsUnchanged();
    return result;
  }

  const sourceData = source.data;
  const own = sheet.formulas?.length ?? 0;
  const before = sheet.data.labels.slice(0, sheet.data.labels.length - own);
  const shifted = shiftForColumnChange(sheet, before, sourceData.labels);
  let base = shifted.sheet;
  const { shift, forcedErrors } = shifted;
  const selected = base.corrections?.signalChannels;
  if (selected && shift !== null) {
    base = { ...base, corrections: { ...base.corrections, signalChannels: remapChannelList(selected, shift) } };
  } else if (selected?.some((channel) => before[channel] !== sourceData.labels[channel])) {
    throw new Error("selected signal columns changed");
  }
  const corrected = await applyCorrections({
    dataset: sourceData,
    params: base.corrections ?? {},
    ...(source.errorRoles ? { error_bindings: source.errorRoles } : {}),
  });
  const { data, formulaErrors } = recomputeFromBaseOrEmpty(corrected, base.formulas);
  const errors = forcedErrors ? { ...formulaErrors, ...forcedErrors } : formulaErrors;
  const result = {
    sheet: {
      ...base,
      data,
      raw: sourceData,
      formulaErrors: errors,
      ...(source.errorRoles ? { errorRoles: [...source.errorRoles] } : {}),
    },
    shift,
  };
  assertInputsUnchanged();
  return result;
}
