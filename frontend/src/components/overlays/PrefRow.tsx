// One label + control row of the Preferences dialog (shared by its panes).

export default function PrefRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="qzk-pref-ctl">{children}</div>
    </div>
  );
}
