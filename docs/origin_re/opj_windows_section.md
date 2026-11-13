# `.opj` windows section — column long-names, units, plot designations, book/sheet names

**Consolidated into [`../origin_project_format.md`](../origin_project_format.md)
on 2026-07-04** (plan item 20) — see §4.1 "`.opj` windows section" for the
byte-level grammar (window-header block, column-property block layout,
label-text block, the plot-designation enum, sheet/layer structure) and
§4.1.1 for the validated column↔dataset mapping rule.

The original reverse-engineering narrative (investigation process, hex
evidence, and confidence notes as first written) is preserved in this file's
git history — see `git log --follow -- docs/origin_re/opj_windows_section.md`.

**2026-11-13 corrections** (public oracle corpus — see the format doc §4.1
and `validation_log.md`): the window label starts at the end of the
header's 195-byte fixed region (the "last printable run past `0x60`" rule
returned the timestamp bytes `"BA"`); the property block's `0x06` is a
flag byte and `0x25`-`0x26` the column's type bytes, not invariant
markers; property blocks are 482-519 bytes and sheet sub-headers 255-409
bytes depending on the Origin version; a property block's label slot is
the very next block, or a NULL.
