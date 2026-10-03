// The two full-Stage workspaces App.tsx swaps in for the Stage, as lazy seams.
//
// R9 (P3.3): each placeholder shown while its chunk is in flight is already a
// `workspace` Escape surface, closing exactly what the loaded workspace's own
// surface closes. It used to register nothing, so an Escape pressed in the
// first few hundred ms did nothing at all. The loaded Library workspace also
// reveals its selection in the tree on close; the placeholder has no tiles to
// have selected from, so it only closes.

import { useEscapeSurface } from "../../lib/escapeStack";
import { lazyRegion } from "../../lib/lazyRegion";
import { useApp } from "../../store/useApp";

export function PendingWorkspace({ className, label, onClose }: { className: string; label: string; onClose: () => void }) {
  useEscapeSurface("workspace", () => {
    onClose();
    return true;
  });
  return <section className={className} aria-label={label} />;
}

export const LibraryWorkspace = lazyRegion(
  () => import("../Library/LibraryWorkspace"),
  "Library workspace",
  ({ onClose }) => <PendingWorkspace className="qzk-library-workspace" label="Library workspace" onClose={onClose} />,
);

function PendingQuickFigureBuilder() {
  const close = useApp((s) => s.closeQuickFigureBuilder);
  return <PendingWorkspace className="qzk-quick-builder" label="Quick Figure Builder" onClose={close} />;
}

export const QuickFigureBuilderWorkspace = lazyRegion(
  () => import("../workshops/quickfigurebuilder/QuickFigureBuilderWorkspace"),
  "Quick Figure Builder",
  <PendingQuickFigureBuilder />,
);
