// Templates section of the Pipeline workshop (#2/#3): save the current steps
// as a named template, load/delete/export/import templates, and batch-run one
// over N picked files (per-file reports + a summary worksheet). Thin — all
// logic lives in useTemplates.

import { useRef, useState } from "react";

import { Button, NumberField, Select } from "../../primitives";
import { useTemplates } from "./useTemplates";

export default function TemplatesSection() {
  const t = useTemplates();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
      <label className="qzk-field-lbl">Templates</label>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
        <NumberField
          numeric={false}
          width={130}
          value={name}
          placeholder="save as…"
          onChange={setName}
        />
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() => {
            void t.saveCurrent(name.trim()).then((err) => {
              setError(err);
              if (!err) setName("");
            });
          }}
        >
          Save
        </Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => importRef.current?.click()}>
          Import…
        </Button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void t.importFile(f).then(setError);
            e.target.value = "";
          }}
        />
      </div>

      {t.templates.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
          <Select
            options={[
              { value: "", label: "pick a template…" },
              ...t.templates.map((x) => ({ value: x.name, label: x.name })),
            ]}
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          />
          <Button size="sm" disabled={!picked} onClick={() => t.load(picked)}>
            Load
          </Button>
          <Button size="sm" disabled={!picked || !!t.batch} onClick={() => fileRef.current?.click()}>
            Batch…
          </Button>
          <Button size="sm" disabled={!picked} onClick={() => t.exportFile(picked)}>
            Export
          </Button>
          <Button
            size="sm"
            disabled={!picked}
            onClick={() => {
              t.remove(picked);
              setPicked("");
            }}
          >
            ×
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length && picked) void t.runBatch(picked, files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {t.batch && (
        <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
          batch {t.batch.done + 1}/{t.batch.total} — {t.batch.current}
          {t.batch.failures.length > 0 && (
            <span style={{ color: "var(--danger)" }}> · {t.batch.failures.length} flagged</span>
          )}
        </div>
      )}
      {error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
