// Reflectivity workshop — one number-list row of the graded layer editor (SLD
// knots, absorption knots, knot positions). The text is a draft: it reaches
// the model only when it parses, and follows the model when the model changes
// elsewhere (the fit's parameter table, "Apply to model") unless it already
// reads as that value. Renders as cells of the editor's 3-column grid.

import { useEffect, useState, type ReactNode } from "react";

export default function GradedListField<T>({
  label,
  name,
  title,
  value,
  format,
  parse,
  onCommit,
  invalid,
  placeholder,
  children,
}: {
  label: string;
  /** The input's accessible name. */
  name: string;
  title: string;
  value: T;
  format: (v: T) => string;
  /** null: the text is not a usable value (it stays a local draft). */
  parse: (text: string) => T | null;
  onCommit: (v: T) => void;
  /** Why an unparseable draft was kept local (one sentence). */
  invalid: string;
  placeholder?: string;
  /** The row's third cell. */
  children?: ReactNode;
}) {
  const shown = format(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    setDraft((d) => {
      const p = parse(d);
      return p !== null && format(p) === shown ? d : shown;
    });
    // `parse`/`format` are module functions; only the model's value matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const onText = (text: string) => {
    setDraft(text);
    const v = parse(text);
    if (v !== null) onCommit(v);
  };

  return (
    <>
      <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }} title={title}>
        {label}
      </span>
      <input
        className="qz-input qz-num"
        aria-label={name}
        title={title}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => onText(e.target.value)}
      />
      {children ?? <span />}
      {parse(draft) === null && (
        <span className="qzk-ds-meta qzk-msg" role="alert" style={{ gridColumn: "2 / 4", color: "var(--danger)" }}>
          {invalid}
        </span>
      )}
    </>
  );
}
