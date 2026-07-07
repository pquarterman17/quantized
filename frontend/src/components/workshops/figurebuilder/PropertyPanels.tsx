// Figure property panels (#11) — collapsible groups covering every export
// property: Text & fonts · Axes & ticks · Legend · Canvas · Annotations.
// (Per-series color/width/style/marker already rides the WYSIWYG
// series_styles passthrough.) Every field writes ONE FigureOverrides object
// that lands as render_figure's `overrides` kwarg — no side channels. Thin:
// state lives in useFigureBuilder.

import { useState } from "react";

import { LEGEND_LOCS, type FigureOverrides } from "../../../lib/figureOverrides";
import { Checkbox, NumberField, Select } from "../../primitives";

/** A labelled numeric field committing a number (or undefined when cleared). */
function Num({
  label,
  value,
  onValue,
  width = 64,
}: {
  label: string;
  value: number | undefined;
  onValue: (v: number | undefined) => void;
  width?: number;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">{label}</label>
      <NumberField
        value={text}
        width={width}
        onChange={(t) => {
          setText(t);
          if (t.trim() === "") onValue(undefined);
          else {
            const v = Number(t);
            if (Number.isFinite(v)) onValue(v);
          }
        }}
      />
    </span>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="qzk-report-section">
      <button className="qzk-group-head" onClick={() => setOpen((o) => !o)}>
        <span className="qzk-group-caret">{open ? "▾" : "▸"}</span>
        <span className="qzk-group-name">{title}</span>
      </button>
      {open && <div style={{ padding: "4px 0 2px 14px", display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>}
    </div>
  );
}

export default function PropertyPanels({
  overrides,
  setOverrides,
}: {
  overrides: FigureOverrides;
  setOverrides: (ov: FigureOverrides) => void;
}) {
  const ov = overrides;
  const patch = (p: Partial<FigureOverrides>) => setOverrides({ ...ov, ...p });
  const [annText, setAnnText] = useState("");
  const [annX, setAnnX] = useState("");
  const [annY, setAnnY] = useState("");

  return (
    <div>
      <Group title="Text & fonts">
        <Num label="font size" value={ov.font_size} onValue={(v) => patch({ font_size: v })} />
        <Num label="title size" value={ov.title_size} onValue={(v) => patch({ title_size: v })} />
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">font name</label>
          <NumberField
            numeric={false}
            width={110}
            value={ov.font_name ?? ""}
            placeholder="(preset)"
            onChange={(t) => patch({ font_name: t.trim() || undefined })}
          />
        </span>
      </Group>

      <Group title="Axes & ticks">
        <Num
          label="x min"
          value={ov.x_lim?.[0] ?? undefined}
          onValue={(v) => patch({ x_lim: [v ?? null, ov.x_lim?.[1] ?? null] })}
        />
        <Num
          label="x max"
          value={ov.x_lim?.[1] ?? undefined}
          onValue={(v) => patch({ x_lim: [ov.x_lim?.[0] ?? null, v ?? null] })}
        />
        <Num
          label="y min"
          value={ov.y_lim?.[0] ?? undefined}
          onValue={(v) => patch({ y_lim: [v ?? null, ov.y_lim?.[1] ?? null] })}
        />
        <Num
          label="y max"
          value={ov.y_lim?.[1] ?? undefined}
          onValue={(v) => patch({ y_lim: [ov.y_lim?.[0] ?? null, v ?? null] })}
        />
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">tick direction</label>
          <Select
            options={[
              { value: "", label: "(preset)" },
              { value: "in", label: "in" },
              { value: "out", label: "out" },
            ]}
            value={ov.ticks?.dir ?? ""}
            onChange={(e) =>
              patch({
                ticks: { ...ov.ticks, dir: (e.target.value || undefined) as "in" | "out" | undefined },
              })
            }
          />
        </span>
        <Num
          label="tick length"
          value={ov.ticks?.len}
          onValue={(v) => patch({ ticks: { ...ov.ticks, len: v } })}
        />
        <Checkbox
          checked={ov.ticks?.minor ?? false}
          onChange={(v) => patch({ ticks: { ...ov.ticks, minor: v || undefined } })}
        >
          minor ticks
        </Checkbox>
        <Checkbox
          checked={ov.spines?.top ?? true}
          onChange={(v) => patch({ spines: { ...ov.spines, top: v } })}
        >
          top spine
        </Checkbox>
        <Checkbox
          checked={ov.spines?.right ?? true}
          onChange={(v) => patch({ spines: { ...ov.spines, right: v } })}
        >
          right spine
        </Checkbox>
        <Checkbox
          checked={ov.grid ?? false}
          onChange={(v) => patch({ grid: v || undefined })}
        >
          grid
        </Checkbox>
      </Group>

      <Group title="Legend">
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">position</label>
          <Select
            options={[
              { value: "", label: "(preset: best)" },
              ...LEGEND_LOCS.map((l) => ({ value: l, label: l })),
            ]}
            value={ov.legend?.loc ?? ""}
            onChange={(e) =>
              patch({ legend: { ...ov.legend, loc: e.target.value || undefined } })
            }
          />
        </span>
        <Checkbox
          checked={ov.legend?.show ?? true}
          onChange={(v) => patch({ legend: { ...ov.legend, show: v } })}
        >
          show
        </Checkbox>
        <Checkbox
          checked={ov.legend?.frame ?? false}
          onChange={(v) => patch({ legend: { ...ov.legend, frame: v } })}
        >
          frame
        </Checkbox>
      </Group>

      <Group title="Canvas (margins, fig fraction)">
        <Num
          label="left"
          value={ov.margins?.left}
          onValue={(v) => patch({ margins: { ...ov.margins, left: v } })}
        />
        <Num
          label="right"
          value={ov.margins?.right}
          onValue={(v) => patch({ margins: { ...ov.margins, right: v } })}
        />
        <Num
          label="top"
          value={ov.margins?.top}
          onValue={(v) => patch({ margins: { ...ov.margins, top: v } })}
        />
        <Num
          label="bottom"
          value={ov.margins?.bottom}
          onValue={(v) => patch({ margins: { ...ov.margins, bottom: v } })}
        />
      </Group>

      <Group title="Annotations">
        {(ov.annotations ?? []).map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
            <span className="qzk-ds-meta">
              “{a.text}” @ ({a.x}, {a.y})
            </span>
            <button
              className="qz-btn qz-ghost qz-sm"
              title="remove annotation"
              onClick={() =>
                patch({ annotations: (ov.annotations ?? []).filter((_, j) => j !== i) })
              }
            >
              ×
            </button>
          </div>
        ))}
        <NumberField
          numeric={false}
          width={110}
          value={annText}
          placeholder="text"
          onChange={setAnnText}
        />
        <NumberField value={annX} width={56} placeholder="x" onChange={setAnnX} />
        <NumberField value={annY} width={56} placeholder="y" onChange={setAnnY} />
        <button
          className="qz-btn qz-sm"
          disabled={!annText.trim() || !Number.isFinite(Number(annX)) || !Number.isFinite(Number(annY))}
          onClick={() => {
            patch({
              annotations: [
                ...(ov.annotations ?? []),
                { x: Number(annX), y: Number(annY), text: annText.trim() },
              ],
            });
            setAnnText("");
            setAnnX("");
            setAnnY("");
          }}
        >
          + Add
        </button>
      </Group>
    </div>
  );
}
