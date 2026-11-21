"""Line splitting for the delimited readers (data lines vs preamble).

Split out of :mod:`quantized.io.delimited` (at its 500-line ceiling) when it
learned the ``[DATA]`` section anchor (`_delimiter_vote.data_section_start`);
``delimited`` re-exports ``_split_lines`` unchanged. Pure layer: strings in,
strings out.
"""

from __future__ import annotations

from quantized.io._delimiter_vote import COMMENT_CHARS, data_section_start
from quantized.io._text_lines import logical_lines, strip_inline_comment


def _split_lines(text: str) -> tuple[list[str], list[str]]:
    """Split into (data lines, comment/preamble lines).

    MAIN_PLAN #33: the comment lines used to be dropped on the floor. An
    instrument preamble routinely carries the sample id, temperature, or
    operator notes that make the file interpretable later, so it is kept in
    ``metadata["comments"]`` rather than discarded — the original file is never
    modified, so this is the only place that context can survive an import.

    Every line above a data-section heading such as ``[DATA]`` (and the
    heading itself) is preamble too (`data_section_start`, worksheet audit #3).
    """
    lines = logical_lines(text)
    section = data_section_start(lines)
    data: list[str] = []
    comments: list[str] = []
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped:
            continue
        if i < section or stripped[0] in COMMENT_CHARS:
            comments.append(stripped)
        else:
            data.append(strip_inline_comment(stripped))
    return data, comments


def strip_sep_hint(text: str) -> str:
    """Drop Excel's leading ``sep=;`` line (it names the delimiter; it is not a
    header row, and left in it became the column names and the x label)."""
    head, _, rest = text.partition("\n")
    first = head.strip()
    if len(first) == 5 and first[:4].lower() == "sep=" and not first[4].isalnum():
        return rest
    return text
