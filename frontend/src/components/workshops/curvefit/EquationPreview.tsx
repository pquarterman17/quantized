// Read-only rendered preview of the custom equation (audit P2.7 stretch:
// "pretty LaTeX rendering while Python remains editable source"). The text in
// EquationEditor stays the single editable source of truth; this draws a COPY
// of it through lib/equationLatex (pure, never throws) and KaTeX, which
// lib/katexLazy fetches the first time there is something to draw -- never at
// startup. Text the converter cannot parse, text the validator rejected, a
// KaTeX refusal and a failed load all draw nothing. The box itself stays while
// there is any text, so the panel does not jump as the user types through
// incomplete expressions (`A*exp(`). aria-hidden: it repeats the field's own
// content, which is what assistive tech already reads.

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { equationToLatex } from "../../../lib/equationLatex";
import { loadTexRenderer, type TexRenderer } from "../../../lib/katexLazy";

interface Props {
  equation: string;
  /** Draw nothing: the validator rejected this text. */
  suppressed: boolean;
}

export default function EquationPreview({ equation, suppressed }: Props) {
  const text = useDeferredValue(equation);
  const tex = useMemo(() => (suppressed ? null : equationToLatex(text)), [text, suppressed]);
  const renderTex = useTexRenderer(tex !== null);
  // KaTeX markup for LaTeX built from a closed grammar (see lib/katexLazy).
  const html = useMemo(() => (tex !== null && renderTex ? renderTex(tex) : null), [tex, renderTex]);
  if (!equation.trim()) return null;
  return (
    <div
      aria-hidden
      data-testid="equation-preview"
      title="Rendered preview. Edit the equation text above."
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 30,
        marginTop: 6,
        padding: "2px 8px",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        border: "1px dashed var(--border-soft)",
        borderRadius: "var(--radius-sm)",
        color: "var(--text)",
        fontSize: "var(--font-size)",
      }}
    >
      {html !== null && <span data-testid="equation-preview-math" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

/** The KaTeX renderer once loaded, starting the load the first time it is
 *  `wanted`. A failed load leaves it null (nothing is drawn; lib/katexLazy
 *  explains why it is not retried). */
function useTexRenderer(wanted: boolean): TexRenderer | null {
  const [renderer, setRenderer] = useState<TexRenderer | null>(null);
  useEffect(() => {
    if (!wanted || renderer) return;
    let live = true;
    loadTexRenderer().then(
      (r) => {
        if (live) setRenderer(() => r);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wanted, renderer]);
  return renderer;
}
