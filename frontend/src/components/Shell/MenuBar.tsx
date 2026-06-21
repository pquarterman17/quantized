// Menu bar: top-level menus (display-only for the first slice) + search chip.
// Menu dropdown wiring lands with the command/menu system (later tier).

const MENUS = ["File", "Edit", "View", "Analyze", "Tools", "Help"];

export default function MenuBar() {
  return (
    <nav className="qzk-menubar">
      {MENUS.map((m) => (
        <span key={m} className="qzk-menu">
          {m}
        </span>
      ))}
      <span className="qzk-spacer" />
      <span className="qzk-search">
        <span>⌕</span>
        <span>Search…</span>
      </span>
    </nav>
  );
}
