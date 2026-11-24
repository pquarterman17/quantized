// The worksheet toolbar's status chips ("Linked to plot", "vars: ..."). They
// are information, not actions, so they stay inline and never go into the
// "⋯" overflow menu (UX menus audit N8: that menu held only these two notes).

export default function WorksheetToolbarStatus({ plotLinked, vars }: { plotLinked: boolean; vars: string }) {
  if (!plotLinked && !vars) return null;
  return (
    <span role="group" aria-label="Status" style={{ display: "contents" }}>
      {plotLinked && (
        <span
          className="qzk-ds-meta"
          style={{ color: "var(--accent)" }}
          title="This worksheet's dataset is the live plot's — row selection highlights plotted points, and Set As › X / Plot as Y edit it directly"
        >
          ⧟ Linked to plot
        </span>
      )}
      <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        vars: {vars}
      </span>
    </span>
  );
}
