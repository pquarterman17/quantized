// Equation text field of the custom-equation fit (GOTO #1) with inline
// syntax feedback (audit P2.7): a syntax error's span, as reported by the
// validate route, is underlined IN the field, and the message (which ends in
// "(column N)") sits under it. The field is an ordinary <input>; the marking
// is an aria-hidden overlay with the same box, font and padding (it carries
// the same `qz-input` class) whose text is transparent except for the wavy
// underline under the error span, kept scrolled with the input so a long
// equation marks the right characters.

import { useId, useLayoutEffect, useRef } from "react";

import type { TextSpan } from "../../../lib/equationSpan";
import type { ValidationStatus } from "./useEquationFit";

interface Props {
  value: string;
  onChange: (text: string) => void;
  status: ValidationStatus;
  validationError: string | null;
  /** UTF-16 span of the error in `value`; only drawn while status is "error". */
  errorSpan: TextSpan | null;
  /** The equation validated fine but has nothing to fit. */
  noParams: boolean;
}

export default function EquationEditor({ value, onChange, status, validationError, errorSpan, noParams }: Props) {
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const span = status === "error" ? errorSpan : null;

  const syncScroll = () => {
    if (inputRef.current && overlayRef.current) overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  useLayoutEffect(syncScroll, [value, span]);

  return (
    <>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          className="qz-input"
          style={{ display: "block", width: "100%", fontFamily: "var(--font-mono)" }}
          placeholder="y = a*exp(-x/t) + c"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyUp={syncScroll}
          onSelect={syncScroll}
          spellCheck={false}
          aria-label="Equation"
          aria-invalid={status === "error"}
          aria-describedby={status === "error" ? messageId : undefined}
        />
        {span && (
          <div
            ref={overlayRef}
            aria-hidden
            className="qz-input"
            data-testid="equation-error-overlay"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              overflow: "hidden",
              whiteSpace: "pre",
              pointerEvents: "none",
              background: "transparent",
              borderColor: "transparent",
              color: "transparent",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span>
              {value.slice(0, span.start)}
              <mark
                data-testid="equation-error-mark"
                style={{
                  color: "transparent",
                  background: "color-mix(in oklab, var(--danger) 18%, transparent)",
                  textDecoration: "underline wavy var(--danger)",
                  textDecorationSkipInk: "none",
                  textUnderlineOffset: 3,
                }}
              >
                {value.slice(span.start, span.end)}
              </mark>
              {value.slice(span.end)}
            </span>
          </div>
        )}
      </div>
      <div className="qzk-ds-meta qzk-msg" style={{ marginTop: 6, minHeight: 16 }}>
        {status === "checking" && <span style={{ color: "var(--text-faint)" }}>checking…</span>}
        {status === "ok" && noParams && (
          <span style={{ color: "var(--text-faint)" }}>no free parameters — add at least one to fit</span>
        )}
        {status === "error" && (
          <span id={messageId} role="alert" style={{ color: "var(--danger)" }}>
            {validationError}
          </span>
        )}
      </div>
    </>
  );
}
