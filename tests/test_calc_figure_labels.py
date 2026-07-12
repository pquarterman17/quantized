"""Rich-text label export (GOTO #5): mathtext passthrough + the literal guard.

Two contracts:
1. A VALID ``$...$`` mathtext label passes through untouched and actually
   engages matplotlib's mathtext engine at export (the SVG output differs
   from a plain-label render).
2. An INVALID mathtext label NEVER raises out of a figure render (it would
   500 an export) -- ``safe_mathtext_label`` de-maths it to literal text at
   every figure module's entry.
"""

from __future__ import annotations

import numpy as np

from quantized.calc.figure import render_figure
from quantized.calc.figure_labels import SUPPORTED_MATHTEXT_COMMANDS, safe_mathtext_label

VALID = r"$\mu_0H$ (T)"
INVALID = r"bad $\foo$ label"  # unknown command -> mathtext parse error

# Bug-hunt regression (screen/export WYSIWYG): all three are VALID raw
# matplotlib mathtext (verified against MathTextParser directly) but use a
# command outside frontend/src/lib/richtext.ts's strict subset -- the screen
# renderer already refuses them (literal + "Invalid markup"), so export must
# match, even though matplotlib itself is happy to parse them.
OUT_OF_SUBSET = (r"$\frac{1}{2}$", r"$\sqrt{2}$", r"$\sum_{i=1}^{n}$")

X = np.linspace(0.0, 10.0, 30)
Y = np.sin(X)


# -- safe_mathtext_label unit behaviour --------------------------------------


def test_plain_label_untouched() -> None:
    assert safe_mathtext_label("Temperature (K)") == "Temperature (K)"
    assert safe_mathtext_label("") == ""


def test_valid_mathtext_passes_through() -> None:
    for label in (VALID, r"$\AA^{-1}$", r"$10^{n}$", r"$\chi''$", r"$\mathrm{H}_{c2}$"):
        assert safe_mathtext_label(label) == label


def test_invalid_mathtext_gets_dollars_escaped() -> None:
    out = safe_mathtext_label(INVALID)
    assert out == r"bad \$\foo\$ label"
    # The escaped form is what matplotlib renders literally -- idempotent too.
    assert safe_mathtext_label(out) == out


def test_odd_dollar_count_is_already_literal() -> None:
    # matplotlib treats an odd unescaped-$ string as plain text; leave it be.
    assert safe_mathtext_label("cost $5") == "cost $5"


def test_unicode_labels_untouched() -> None:
    s = "2θ (°)  Å"  # 2theta (degree) Angstrom, no $ at all
    assert safe_mathtext_label(s) == s


# -- bug-hunt regression: out-of-subset commands fall back to literal, even
#    though raw matplotlib mathtext accepts them (screen/export WYSIWYG) ----


def test_out_of_subset_command_falls_back_to_literal_though_matplotlib_would_accept_it() -> None:
    for label in OUT_OF_SUBSET:
        out = safe_mathtext_label(label)
        # De-mathed exactly like an unknown-command failure: dollars escaped,
        # never left as mathtext (which would render a real fraction/root/sum
        # in the export while the screen showed literal "Invalid markup").
        assert out == label.replace("$", r"\$")
        assert out != label
        # Idempotent, and never raises on a second pass.
        assert safe_mathtext_label(out) == out


def test_out_of_subset_command_never_raises_through_render_figure() -> None:
    for label in OUT_OF_SUBSET:
        out = render_figure(X, [("y", Y)], title=label, x_label=label, y_label=label, fmt="svg")
        assert b"<svg" in out[:300]


def test_supported_command_set_matches_richtext_ts_subset() -> None:
    # Sanity-check the ported frozenset against the exact commands the
    # existing "valid" fixtures below rely on -- keeps the two sides from
    # silently drifting apart.
    for cmd in ("mu", "AA", "chi", "mathrm", "mathit"):
        assert cmd in SUPPORTED_MATHTEXT_COMMANDS
    for cmd in ("frac", "sqrt", "sum", "foo"):
        assert cmd not in SUPPORTED_MATHTEXT_COMMANDS


# -- MAIN #28 commit 1: relations / arrows / analysis glyphs joined the subset

RELATION_LABELS = (
    r"$T \leq T_c$",
    r"$\mu_0H \rightarrow \infty$",
    r"$a \approx b \neq c \geq d$",
    r"$x \propto y^2$",
    r"$\nabla \cdot E \parallel \partial_x$",
)


def test_relation_commands_pass_through_untouched() -> None:
    # In-subset AND valid mathtext -> returned verbatim (mathtext renders the
    # same glyph richtext.ts substitutes on screen: WYSIWYG).
    for label in RELATION_LABELS:
        assert safe_mathtext_label(label) == label


def test_relation_commands_render_without_raising() -> None:
    for label in RELATION_LABELS:
        out = render_figure(X, [("y", Y)], x_label=label, y_label=label, fmt="svg")
        assert b"<svg" in out[:300]


def test_relation_commands_in_supported_set() -> None:
    for cmd in ("leq", "geq", "neq", "approx", "equiv", "sim", "propto", "ll",
                "gg", "infty", "partial", "nabla", "perp", "parallel", "angle",
                "cdots", "ldots", "dots", "rightarrow", "to", "leftarrow",
                "leftrightarrow", "Rightarrow", "mp", "div"):
        assert cmd in SUPPORTED_MATHTEXT_COMMANDS


# -- figure render integration ------------------------------------------------


def test_mathtext_label_export_engages_mathtext() -> None:
    plain = render_figure(X, [("y", Y)], x_label="u0H (T)", fmt="svg")
    rich = render_figure(X, [("y", Y)], x_label=VALID, fmt="svg")
    assert b"<svg" in rich[:300]
    # mathtext produced different glyph paths than the plain label.
    assert rich != plain


def test_mathtext_label_exports_pdf() -> None:
    out = render_figure(
        X, [("y", Y)], title=r"$\Delta T$ sweep", x_label=VALID, y_label=r"$M_{s}$", fmt="pdf"
    )
    assert out[:5] == b"%PDF-"


def test_invalid_label_never_raises() -> None:
    out = render_figure(
        X,
        [(INVALID, Y), ("ok", Y * 2)],  # legend label invalid too
        title=INVALID,
        x_label=INVALID,
        y_label=INVALID,
        fmt="svg",
    )
    assert b"<svg" in out[:300]


def test_invalid_annotation_never_raises() -> None:
    out = render_figure(
        X,
        [("y", Y)],
        fmt="svg",
        overrides={"annotations": [{"text": INVALID, "x": 1.0, "y": 0.5}]},
    )
    assert b"<svg" in out[:300]


# -- MAIN #25 (rich-text annotations): the frontend canvas/hit-test side ----
# ports the SAME `$...$` micro-syntax to annotation text (lib/uplotOverlays.ts
# annotationLayout/annotationPlugin); _apply_overrides already routes every
# annotation's text through `safe_mathtext_label` (figure_overrides.py) --
# these tests confirm that guard actually delivers WYSIWYG mathtext at
# export time (not just "doesn't raise"), and that it covers the MAIN #18/
# #21 additions (per-annotation `size`, page anchoring) too.


def test_valid_mathtext_annotation_engages_mathtext() -> None:
    plain_ann = [{"text": "u0H", "x": 1.0, "y": 0.5}]
    rich_ann = [{"text": VALID, "x": 1.0, "y": 0.5}]
    plain = render_figure(X, [("y", Y)], fmt="svg", overrides={"annotations": plain_ann})
    rich = render_figure(X, [("y", Y)], fmt="svg", overrides={"annotations": rich_ann})
    assert b"<svg" in rich[:300]
    assert rich != plain  # mathtext produced different glyph paths


def test_valid_mathtext_annotation_with_page_anchor_and_size_never_raises() -> None:
    # The MAIN #21 (page anchor) and MAIN #18 (per-annotation size) additions
    # both feed into the SAME `ax.annotate(safe_mathtext_label(...), ...)`
    # call in _apply_overrides -- combined with valid markup here to confirm
    # none of the three interact badly.
    ann = [{"text": VALID, "x": 0.5, "y": 0.5, "anchor": "page", "size": 24}]
    out = render_figure(X, [("y", Y)], fmt="svg", overrides={"annotations": ann})
    assert b"<svg" in out[:300]


def test_invalid_mathtext_annotation_with_page_anchor_and_size_falls_back_to_literal() -> None:
    ann = [{"text": INVALID, "x": 0.5, "y": 0.5, "anchor": "page", "size": 24}]
    out = render_figure(X, [("y", Y)], fmt="svg", overrides={"annotations": ann})
    assert b"<svg" in out[:300]


def test_invalid_label_with_x_breaks_never_raises() -> None:
    # The breaks branch receives the already-sanitized strings from figure.py.
    out = render_figure(
        X,
        [(INVALID, Y), ("b", Y + 1.0)],
        title=INVALID,
        y_label=INVALID,
        fmt="svg",
        overrides={"x_breaks": [[4.0, 6.0]]},
    )
    assert b"<svg" in out[:300]


def test_invalid_labels_across_figure_modules_never_raise() -> None:
    """Every figure_* module routes user strings through the shared guard."""
    from quantized.calc.figure_categorical import render_categorical_figure
    from quantized.calc.figure_corner import render_corner_figure
    from quantized.calc.figure_facets import render_facets_figure
    from quantized.calc.figure_field import render_field_figure
    from quantized.calc.figure_map import render_map_figure
    from quantized.calc.figure_statplots import render_statplot_figure
    from quantized.calc.figure_ternary import render_ternary_figure

    bad = INVALID
    outs = [
        render_statplot_figure(
            "box", [[1.0, 2.0, 3.0], [2.0, 3.0, 4.0]], labels=[bad, "g2"],
            title=bad, x_label=bad, y_label=bad, fmt="svg",
        ),
        render_map_figure(
            [0.0, 1.0, 2.0], [0.0, 1.0], [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
            kind="heatmap", title=bad, x_label=bad, y_label=bad, z_label=bad, fmt="svg",
        ),
        render_categorical_figure(
            [bad, "g2"], [bad], [[1.0], [2.0]], title=bad, x_label=bad, y_label=bad,
            fmt="svg",
        ),
        render_ternary_figure(
            [[0.2, 0.3, 0.5], [0.4, 0.4, 0.2]], labels=(bad, "B", "C"), title=bad,
            fmt="svg",
        ),
        render_field_figure(
            [0.0, 1.0], [0.0, 1.0], [[1.0, 1.0], [1.0, 1.0]], [[0.0, 1.0], [1.0, 0.0]],
            title=bad, x_label=bad, y_label=bad, fmt="svg",
        ),
        render_corner_figure(
            [[1.0, 2.0], [1.1, 2.2], [0.9, 1.8], [1.05, 2.1]], [bad, "p2"], title=bad,
            fmt="svg",
        ),
        render_facets_figure(
            [
                {"label": bad, "x": [0.0, 1.0], "series": [{"label": bad, "y": [1.0, 2.0]}]},
                {"label": "L2", "x": [0.0, 1.0], "series": [{"label": "s", "y": [2.0, 1.0]}]},
            ],
            title=bad, x_label=bad, y_label=bad, fmt="svg",
        ),
    ]
    for out in outs:
        assert b"<svg" in out[:300]


def test_valid_mathtext_across_key_modules() -> None:
    from quantized.calc.figure_statplots import render_statplot_figure

    out = render_statplot_figure(
        "histogram", [1.0, 2.0, 2.0, 3.0, 3.0, 3.0, 4.0],
        title=VALID, x_label=r"$\AA^{-1}$", y_label="count", fmt="svg",
    )
    assert b"<svg" in out[:300]
