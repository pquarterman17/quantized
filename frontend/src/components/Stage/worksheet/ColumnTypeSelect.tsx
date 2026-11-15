// The worksheet header's modeling-type control (Continuous / Ordinal / Nominal).
//
// It is a SMALL corner affordance, not a header-wide control: the header body
// belongs to the select-column click (Origin / Excel muscle memory), so the
// type picker must never be where a click lands. A native <select> keeps it
// keyboard- and screen-reader-accessible (Tab, arrows, a spoken label naming
// the column); the same choice is also in the column's context menu
// (columnTypeMenu.ts).

import type { ModelingType } from "../../../lib/types";
import { Select } from "../../primitives";

/** Compact modeling-type tags — the same table as ChannelsCard's. */
const TYPE_WORD: Record<ModelingType, string> = { continuous: "Continuous", ordinal: "Ordinal", nominal: "Nominal" };
const TYPE_TAG: Record<ModelingType, string> = { continuous: "C", ordinal: "O", nominal: "N" };

interface Props {
  /** The column's display name, for the accessible label. */
  name: string;
  /** The EFFECTIVE type (override-or-inferred). */
  effective: ModelingType;
  /** The user's override; undefined = auto-inferred. */
  override?: ModelingType;
  onChange: (t: ModelingType | null) => void;
}

export default function ColumnTypeSelect({ name, effective, override, onChange }: Props) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Select
      className="qzk-col-type"
      value={override ?? ""}
      // The visible text is compact ("auto·C"); the spoken label carries the full state.
      aria-label={`Modeling type of column ${name}: ${TYPE_WORD[effective]}${override ? "" : " (auto)"}`}
      onClick={stop}
      onDoubleClick={stop}
      onChange={(e) => {
        e.stopPropagation();
        onChange(e.target.value === "" ? null : (e.target.value as ModelingType));
      }}
      title="Modeling type — Continuous: a measurement axis · Ordinal: ordered levels · Nominal: categories; Auto = inferred (a level table always reads as nominal)."
      options={[
        { value: "", label: `auto·${TYPE_TAG[effective]}` },
        { value: "continuous", label: "Cont" },
        { value: "ordinal", label: "Ord" },
        { value: "nominal", label: "Nom" },
      ]}
    />
  );
}
