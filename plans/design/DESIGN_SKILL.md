---
name: quantized-design
description: Use this skill to generate well-branded interfaces and assets for Quantized — a modern, open-source OriginPro-style app for materials-characterization data (magnetometry, XRD, neutron reflectometry, lab data), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping. Shares its visual language with the sibling fermiviewer EM app.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

Start here:
- `readme.md` — the full design guide: content fundamentals, visual foundations, iconography, and a file index.
- `styles.css` — the single stylesheet to link; it `@import`s all tokens (`tokens/*.css`) and the `qz-*` component class layer (`components/components.css`).
- `components/<group>/*.prompt.md` — what each React primitive is and how to use it (Button, Card, DataTable, NumberField, …).
- `ui_kits/workbench/` — the Analysis Workbench + DiraCulator screens, the reference for full-app layout.
- `guidelines/cards/` — foundation specimen cards (colors, type, spacing, brand).

Working rules:
- Dark-first, oklch tokens, **one violet accent**, amber means "a mode is armed", JetBrains Mono for every number. Color is rationed; borders over shadows; cursors are `default`. Never use emoji. Use Unicode glyphs for icons.
- If creating visual artifacts (slides, mocks, throwaway prototypes), copy the assets you need out of `assets/` and produce static HTML files that link `styles.css` (and the `_ds_bundle.js` if you need the React components).
- If working on production code, copy assets and read the rules here to become an expert in designing with this brand; reuse the shared tokens so code ports between Quantized and fermiviewer.

If the user invokes this skill without other guidance, ask what they want to build or design, ask a few focused questions, and act as an expert designer who outputs HTML artifacts *or* production code, depending on the need.
