// The Library panel's flat section cluster, lifted out of Library.tsx (which
// sits against the 400-line component ceiling) and, since every one of these
// sections is chunk-deferred, the single LOADER module for that seam family.
//
// Sections whose items are now tree children (workbook worksheets, figures,
// pages, reports) hide while the tree renders — and hide during search too
// (PR D2: the results surface covers every kind WITH the query applied; the
// sections were unfiltered). The true-empty state is the only remaining
// flat-section surface.
//
// Bundle diet slice 4 (plans/BUNDLE_HEADROOM.md): every section below already
// rendered `null` until its own store collection was non-empty, and a FRESH
// project's collections are all empty — so on the default first paint their
// bodies were dead weight in the entry chunk. Each is now `lazy()` behind the
// SAME emptiness test the section applies internally, so its chunk is
// requested strictly after the user authors that content or opens a project
// that already had it (a persisted-state restore), never on first paint.
// `BookFamiliesSection` is the one exception and stays static: its gate is a
// DERIVED value (`originBookFamilies(datasets)`), so gating the seam on it
// would mean recomputing that grouping in this component on every dataset
// change just to decide whether to fetch a 1 kB chunk.

import { lazy, Suspense } from "react";

import BookFamiliesSection from "./BookFamiliesSection";
import type { LibraryHierarchy, LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";

const CollectionsSection = lazy(() => import("./CollectionsSection"));
const EditableFiguresSection = lazy(() => import("./EditableFiguresSection"));
const FiguresSection = lazy(() => import("./FiguresSection"));
const OriginFidelitySection = lazy(() => import("./OriginFidelitySection"));
const PagesSection = lazy(() => import("./PagesSection"));
const ReportsSection = lazy(() => import("./ReportsSection"));
const SavedFiguresSection = lazy(() => import("./SavedFiguresSection"));
const SmartFoldersSection = lazy(() => import("./SmartFoldersSection"));

export interface LibrarySectionsProps {
  /** True while the hierarchy tree is rendering — the sections whose items
   *  are tree children hide, so nothing is a Library item twice. */
  inHierarchy: boolean;
  searchActive: boolean;
  hierarchy: LibraryHierarchy;
  onFilterTag: (query: string) => void;
  onShowInLibrary: (node: LibraryNode) => void;
}

export default function LibrarySections(p: LibrarySectionsProps) {
  // Subscribe to the COUNT, not the array, so a section's chunk is requested
  // exactly when that section would stop rendering null and never re-fetched
  // on an unrelated item edit.
  const originFigureCount = useApp((s) => s.originFigures.length);
  const originFidelityCount = useApp((s) => s.originFidelity.length);
  const figureDocCount = useApp((s) => s.figureDocs.length);
  const reportCount = useApp((s) => s.reports.length);
  const smartFolderCount = useApp((s) => s.smartFolders.length);
  const collectionCount = useApp((s) => s.collections.length);
  const flat = !p.inHierarchy && !p.searchActive;
  return (
    <>
      {flat && originFigureCount > 0 && (
        <Suspense fallback={null}>
          <FiguresSection />
        </Suspense>
      )}
      {!p.searchActive && originFidelityCount > 0 && (
        <Suspense fallback={null}>
          <OriginFidelitySection />
        </Suspense>
      )}
      {flat && (
        <Suspense fallback={null}>
          <EditableFiguresSection />
        </Suspense>
      )}
      {flat && figureDocCount > 0 && (
        <Suspense fallback={null}>
          <SavedFiguresSection />
        </Suspense>
      )}
      {flat && (
        <Suspense fallback={null}>
          <PagesSection />
        </Suspense>
      )}
      {flat && reportCount > 0 && (
        <Suspense fallback={null}>
          <ReportsSection />
        </Suspense>
      )}
      {!p.searchActive && <BookFamiliesSection />}
      {smartFolderCount > 0 && (
        <Suspense fallback={null}>
          <SmartFoldersSection onFilterTag={p.onFilterTag} />
        </Suspense>
      )}
      {collectionCount > 0 && (
        <Suspense fallback={null}>
          <CollectionsSection hierarchy={p.hierarchy} onShowInLibrary={p.onShowInLibrary} />
        </Suspense>
      )}
    </>
  );
}
