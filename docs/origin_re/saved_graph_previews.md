# Saved Origin graph previews

Origin decode plan item #51 preserves file-saved graph references without
claiming that a thumbnail is current or publication resolution.

## CPYUA (`.opju`) contract

Every CPYUA page has a byte span bounded by the validated page-header grammar
in `opju_figure_curves.opju_pages`. Workbook/report pages are independently
identified by the global column-id table. A preview is attributed only when:

1. the page owns a decoded named graph layer and owns no worksheet columns;
2. exactly one PNG begins and ends inside that same page span;
3. every PNG chunk fits the span, the first chunk is a plausible IHDR, every
   chunk CRC matches, dimensions are bounded, and IEND is present.

The original bytes are base64-wrapped into `saved_preview`; they are never
decoded or recompressed. Metadata includes format/MIME, dimensions, SHA-256,
page name, and `exact_page` attribution confidence. Every layer of a
multi-layer graph page shares that same saved page reference.

If a decoded graph page has zero valid images, it remains an explicit
`no_preview` diagnostic. Multiple valid images remain `ambiguous` diagnostics
with their original bytes preserved and are not attached to a figure.
Worksheet thumbnails are counted as `workbook_thumbnail` diagnostics but are
not transported again as graph assets.

## CPYA (`.opj`) boundary

The real CPYA corpus contains no PNG signatures. A format census found only
tiny icon/storage families in the files that contain image-like magic:

- 108-byte EMF records;
- 8x8 one-bit DIB records;
- byte coincidences resembling JPEG starts that do not parse as complete JPEGs.

None has evidence tying it to a graph page, and the common `.opj` files have no
image signature at all. They are therefore not surfaced as saved graph
previews. `.opj` figures keep the `saved_graph_preview` fidelity omission. A
future CPYA implementation needs an independently proven object/page boundary
and real visual oracle; it must not promote these icon records.

## Corpus acceptance

The local `../test-data/origin` sweep produced:

| Project | Named layer records | Records with exact saved preview |
|---|---:|---:|
| Fixed Lambdas SI.opju | 8 | 8 |
| Hc2 data.opju | 39 | 39 |
| RockingCurve.opju | 6 | 6 |
| UnpolPlots.opju | 8 | 8 |
| XAS.opju | 3 | 3 |
| **Total** | **64** | **64** |

There were zero ambiguous graph-page attributions. The committed realdata test
pins XAS's three distinct 200-pixel-wide references without committing private
project bytes or hashes.

## UI and persistence

An Origin figure row with a valid saved reference gains a preview toggle. The
image expands in the Library beside the still-editable Stage graph and is
explicitly labeled **Saved Origin preview** with the caveat that it may be
stale or low resolution. The browser source is fixed to `image/png` and guarded
by format, dimension, hash-shape, base64-shape, and size checks.

Saved previews and attribution metadata round-trip through `.dwk` unchanged.
Project-level preview diagnostics remain in the version-1 fidelity manifest as
an optional field, preserving backward compatibility with workspaces created
before item #51.
