// The "include in PDF export" checkbox on an editable-figure row (flat section
// and tree alike), with the page number it will get once ticked.

import { useFigurePdfTicks } from "../../store/figurePdfTicks";

export default function FigurePdfTick({ id, name, tabIndex }: { id: string; name: string; tabIndex?: number }) {
  const index = useFigurePdfTicks((s) => s.ids.indexOf(id));
  const toggle = useFigurePdfTicks((s) => s.toggle);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span onClick={stop} onDoubleClick={stop} onKeyDown={stop} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <input type="checkbox" tabIndex={tabIndex} aria-label={`Select figure ${name} for PDF export`} checked={index >= 0} onChange={() => toggle(id)} />
      {index >= 0 && <span className="qzk-fig-meta" title={`PDF page ${index + 1}`}>{index + 1}</span>}
    </span>
  );
}
