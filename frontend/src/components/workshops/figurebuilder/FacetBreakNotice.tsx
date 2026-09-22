/** A facet grid wins over x-axis breaks; offer one explicit way to switch modes. */
export default function FacetBreakNotice({ onClear }: { onClear?: () => void }) {
  return (
    <div role="status" className="qzk-ds-meta" style={{ width: "100%" }}>
      X-axis breaks are inactive while this figure is faceted.
      {onClear && (
        <button className="qz-btn qz-ghost qz-sm" onClick={onClear}>
          Remove faceting and use breaks
        </button>
      )}
    </div>
  );
}
