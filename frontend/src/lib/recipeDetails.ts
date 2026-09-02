// P3.5 slice 4 — the per-row DETAILS surface: everything a Library row's
// disclosure shows once a user deliberately opens it. Pure (no React) so it
// is unit-testable directly, and so `components/workshops/recipelibrary/
// RecipeDetails.tsx` stays a small, dumb renderer.
//
// THE "SUMMARY IS SHAPE, DETAILS CAN BE CONTENT" LINE, RESTATED. `recipeSources.ts`'s
// header draws the rule for a LIST row: a summary counts things, it never
// quotes them. A row the user has explicitly expanded is a different surface
// — the equivalent of opening a file's properties dialog — so THIS module may
// show a fit model's equation or an analysis template's step labels. It must
// not show anything BEYOND what the owning workshop itself would show on that
// recipe (no raw dataset content, no other user's data) — every field below
// is drawn from the recipe record itself, never from applying it.
//
// LOCATING THE RECORD. Six systems, six lookups: `sources.plotProject`/
// `plotGlobal` by id (workspace-backed, supplied by the caller — `lib/` may
// not import `store/`), `sources.quickPlot` by id, and the four name-keyed
// systems' own `load*` by name (their id IS the name — see
// `lib/recipeLibrary.ts`'s header). A miss returns `null`: the row was
// rendered from a snapshot and the underlying recipe is gone by the time the
// user opened it — a normal race with another tab, an undo, or a delete
// elsewhere, never a bug to throw over.

import { loadCustomModels, type CustomFitModel } from "./fitmodels";
import { loadGraphTemplates, type GraphTemplate } from "./figuredoc";
import { loadRecipes as loadPeakRecipes, type PeakRecipe } from "./peakwizard";
import {
  NAME_KEYED_WORKSHOP_LABEL,
  RECIPE_KIND_LABEL,
  supportsOperation,
  type RecipeDescriptor,
  type RecipeKind,
  type RecipeOperation,
} from "./recipeLibrary";
import type { RecipeSourceInput } from "./recipeSources";
import { loadTemplates, type AnalysisTemplate } from "./template";

export interface RecipeDetailsField {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

export interface RecipeDetailsSection {
  readonly title: string;
  readonly items: readonly string[];
}

export interface RecipeDetails {
  readonly fields: readonly RecipeDetailsField[];
  readonly sections?: readonly RecipeDetailsSection[];
}

// ── "Available actions", derived — never hardcoded per kind ────────────────

/** Every row-level operation's label. `apply`/`import` are deliberately
 *  excluded: `apply` is folded into the primary verb below (every kind
 *  supports it, so listing it separately would say nothing), and `import`
 *  is a LIBRARY-level gesture, never something you do TO an existing row. */
const OP_LABEL: Record<Exclude<RecipeOperation, "apply" | "import">, string> = {
  rename: "Rename",
  duplicate: "Duplicate",
  copyScope: "Copy to other scope",
  export: "Export",
  delete: "Delete",
};

/** In display order. Typed off `OP_LABEL`'s own keys (not `RecipeOperation`
 *  at large) so indexing it below needs no cast. */
const ROW_OPS: readonly (keyof typeof OP_LABEL)[] = ["rename", "duplicate", "copyScope", "export", "delete"];

function isNameKeyedKind(kind: RecipeKind): kind is keyof typeof NAME_KEYED_WORKSHOP_LABEL {
  return kind in NAME_KEYED_WORKSHOP_LABEL;
}

/** The exact verb a row's primary button would show — never "Apply" for a
 *  kind the Library can only open a workshop for. Mirrors
 *  `recipeActions.ts`'s `primaryActionLabel`, but pure: no store, so this
 *  reads the shared `NAME_KEYED_WORKSHOP_LABEL` table instead of a
 *  component-local map. */
function primaryVerb(kind: RecipeKind): string {
  return isNameKeyedKind(kind) ? `Open in ${NAME_KEYED_WORKSHOP_LABEL[kind]}` : "Apply";
}

function availableActionsValue(kind: RecipeKind): string {
  const verbs = [primaryVerb(kind), ...ROW_OPS.filter((op) => supportsOperation(kind, op)).map((op) => OP_LABEL[op])];
  return verbs.join(", ");
}

function actionsField(kind: RecipeKind): RecipeDetailsField {
  return { label: "Available actions", value: availableActionsValue(kind) };
}

// ── Common fields every kind carries ────────────────────────────────────────

function commonFields(
  row: RecipeDescriptor,
  timestamps: { createdAt?: string; modifiedAt?: string } | null,
  technique: string | undefined,
): RecipeDetailsField[] {
  const c = row.capabilities;
  const fields: RecipeDetailsField[] = [
    { label: "Kind", value: RECIPE_KIND_LABEL[row.kind] },
    { label: "Scope", value: row.ref.scope === "project" ? "This project" : "Global" },
    // The plan requires the version to be VISIBLE even when there isn't one —
    // an omitted line reads as "forgot to check", not "doesn't apply".
    { label: "Schema version", value: c.schemaVersioned ? `v${row.schemaVersion ?? "?"}` : "unversioned" },
  ];
  if (c.hasTimestamps && timestamps) {
    if (timestamps.createdAt) fields.push({ label: "Created", value: new Date(timestamps.createdAt).toLocaleString(), mono: true });
    if (timestamps.modifiedAt) fields.push({ label: "Modified", value: new Date(timestamps.modifiedAt).toLocaleString(), mono: true });
  }
  if (c.hasTechnique && technique) {
    fields.push({ label: "Technique", value: technique });
  }
  if (row.lastUsedAt) {
    fields.push({ label: "Last used", value: new Date(row.lastUsedAt).toLocaleString(), mono: true });
    fields.push({ label: "Use count", value: String(row.useCount) });
  }
  fields.push({ label: "Tags", value: row.tags.length ? row.tags.join(", ") : "—" });
  return fields;
}

// ── Kind-specific builders ──────────────────────────────────────────────────

function plotDetails(row: RecipeDescriptor, r: RecipeSourceInput["plotProject"][number]): RecipeDetails {
  const fields = commonFields(row, r, r.technique);
  fields.push(
    { label: "Mark", value: r.visual.mark },
    { label: "X scale", value: r.visual.xScale },
    { label: "Y scale", value: r.visual.yScale },
  );
  if (r.description) fields.push({ label: "Description", value: r.description });
  fields.push(actionsField(row.kind));
  const channels = r.signature.map((s) => `${s.role} · ${s.label}${s.unit ? ` (${s.unit})` : ""}`);
  return { fields, sections: [{ title: "Channels", items: channels }] };
}

function quickPlotDetails(row: RecipeDescriptor, t: RecipeSourceInput["quickPlot"][number]): RecipeDetails {
  const fields = commonFields(row, t, t.technique);
  fields.push({ label: "Applies to", value: t.scope.kind === "schema" ? "This data type and schema" : "This workbook only" });
  fields.push(actionsField(row.kind));
  // `signature.channels` is every column in save-time order; `labels` holds
  // the EXACT label only for the columns the mapping references (the others
  // are simply absent). So: exact label where there is one, the signature's
  // normalized label otherwise -- never a bare `#i` placeholder, which reads
  // as "nothing here" for a column that plainly exists. Referenced columns
  // are marked so the user can tell which ones the template actually uses.
  const channels = t.signature.channels.map((ch, i) => {
    const used = i in t.labels;
    const label = used ? t.labels[i] : ch.label;
    const unit = ch.unit ? ` (${ch.unit})` : "";
    const role = ch.errorRole !== "value" ? ` · ${ch.errorRole}` : "";
    return `${label}${unit}${role}${used ? "" : " · not used"}`;
  });
  return { fields, sections: [{ title: "Channels", items: channels }] };
}

function analysisDetails(row: RecipeDescriptor, t: AnalysisTemplate): RecipeDetails {
  const fields = commonFields(row, null, undefined);
  fields.push(actionsField(row.kind));
  const steps = t.steps.map((s) => `${s.kind}: ${s.label}`);
  return { fields, sections: [{ title: "Steps", items: steps }, { title: "Outputs", items: [...t.outputs] }] };
}

function peakDetails(row: RecipeDescriptor, r: PeakRecipe): RecipeDetails {
  const fields = commonFields(row, null, undefined);
  fields.push(
    { label: "Range", value: `${r.range.lo ?? "auto"} – ${r.range.hi ?? "auto"}` },
    { label: "Baseline method", value: r.baseline.method },
    {
      label: "Find thresholds",
      value: `SNR ≥ ${r.find.snr_threshold}, prominence ≥ ${r.find.min_prominence}, max ${r.find.max_peaks} peaks`,
    },
    { label: "Model", value: `${r.model.shape}, bg degree ${r.model.bgDegree}, link ${r.model.linkMode}` },
    { label: "Report mode", value: r.report.mode },
  );
  fields.push(actionsField(row.kind));
  return { fields };
}

/** null → the glyphs a bound-list column already uses elsewhere in this app
 *  for an open side ("−∞"/"∞"), never the word "null" — this is a details
 *  panel a user reads, not a debugger. */
function boundText(v: number | null, openGlyph: string): string {
  return v === null ? openGlyph : String(v);
}

function fitModelDetails(row: RecipeDescriptor, m: CustomFitModel): RecipeDetails {
  const fields = commonFields(row, null, undefined);
  fields.push({ label: "Equation", value: m.equation, mono: true });
  fields.push(actionsField(row.kind));
  const params = m.params.map(
    (name, i) => `${name} = ${m.guesses[i]} [${boundText(m.lower[i], "−∞")}, ${boundText(m.upper[i], "∞")}]`,
  );
  return { fields, sections: [{ title: "Parameters", items: params }] };
}

function graphDetails(row: RecipeDescriptor, t: GraphTemplate): RecipeDetails {
  const fields = commonFields(row, null, undefined);
  fields.push(
    { label: "Style", value: t.style },
    { label: "Overrides", value: String(t.overrides ? Object.keys(t.overrides).length : 0) },
    { label: "Series styles", value: String(t.seriesStyles ? t.seriesStyles.length : 0) },
    { label: "Source", value: t.source === "origin" ? "imported from Origin" : "saved in Figure Builder" },
  );
  fields.push(actionsField(row.kind));
  return { fields };
}

// ── Entry point ──────────────────────────────────────────────────────────

/** Assemble the details for one row, or `null` if the underlying record is
 *  already gone. Re-reads the four name-keyed systems' storage directly
 *  (cheap — the same `load*` the Library already calls every render) rather
 *  than trusting anything cached on `row`, since a row the user opened may
 *  be stale by the time they open it. */
export function recipeDetails(row: RecipeDescriptor, sources: RecipeSourceInput): RecipeDetails | null {
  const { ref } = row;
  switch (ref.kind) {
    case "plot": {
      const list = ref.scope === "project" ? sources.plotProject : sources.plotGlobal;
      const record = list.find((r) => r.id === ref.id);
      return record ? plotDetails(row, record) : null;
    }
    case "quickPlot": {
      const record = sources.quickPlot.find((t) => t.id === ref.id);
      return record ? quickPlotDetails(row, record) : null;
    }
    case "analysis": {
      const record = loadTemplates().find((t) => t.name === ref.id);
      return record ? analysisDetails(row, record) : null;
    }
    case "peak": {
      const record = loadPeakRecipes().find((r) => r.name === ref.id);
      return record ? peakDetails(row, record) : null;
    }
    case "graph": {
      const record = loadGraphTemplates().find((t) => t.name === ref.id);
      return record ? graphDetails(row, record) : null;
    }
    case "fitModel": {
      const record = loadCustomModels().find((m) => m.name === ref.id);
      return record ? fitModelDetails(row, record) : null;
    }
  }
}
