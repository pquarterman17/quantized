// Help topics for the Library panel's objects (PRIMARY_SOFTWARE_AUDIT_PLAN
// ~6040). The Library, folder and workbook context menus' "Help with …"
// footers seed these titles as their queries, so each footer lands on its own
// topic instead of the nearest command ("Toggle library panel").
// One short sentence per topic; every action named is a real menu entry
// (`folderRowMenu.ts`, `lib/workbookContextActions.ts`, `libraryTileMenu.ts`).

import type { HelpItem } from "./helpContent";

export const LIBRARY_HELP_ITEMS: readonly HelpItem[] = [
  {
    key: "library.items",
    title: "Library items",
    detail: "The Library lists the project's worksheets, workbooks, figures, pages and reports; right-click any item for its actions.",
    meta: "Library panel",
    keywords: "library panel tree tiles details worksheet dataset figure page report item",
  },
  {
    key: "library.folders",
    title: "Library folders",
    detail: "Folders organize Library items; right-click a folder to add a subfolder, rename, export it as CSV or delete it.",
    meta: "Library panel",
    keywords: "library folder subfolder organize move group",
  },
  {
    key: "library.workbooks",
    title: "Library workbooks",
    detail: "A workbook groups the worksheets of one import; right-click it to open, Quick Plot, reimport or move it.",
    meta: "Library panel",
    keywords: "library workbook book worksheets sheets reimport quick plot",
  },
];
