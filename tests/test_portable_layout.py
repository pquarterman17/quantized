"""Unit tests for ``quantized.portable.layout`` — the pure bundle-contract
path rules (P1.7 "Pack Project" PR 1)."""

from __future__ import annotations

import os

import pytest

from quantized.portable.layout import (
    MAX_COMPONENT_BYTES,
    basename_of,
    is_bundle_relative,
    join_bundle_path,
    path_key,
    sanitize_component,
    split_ext,
)

# ── basename_of ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/data/run1.csv", "run1.csv"),
        ("C:\\lab\\data\\run1.csv", "run1.csv"),
        ("\\\\server\\share\\run1.csv", "run1.csv"),
        ("run1.csv", "run1.csv"),
        ("/data/sub/", ""),
        ("C:/data/run1.csv", "run1.csv"),
        ("/data/mixed\\sep/run1.csv", "run1.csv"),
    ],
)
def test_basename_of(path: str, expected: str) -> None:
    assert basename_of(path) == expected


# ── path_key ──────────────────────────────────────────────────────────────


def test_path_key_posix() -> None:
    assert path_key("/data/run1.csv") == "data/run1.csv"


def test_path_key_windows_drive() -> None:
    assert path_key("C:\\lab\\data\\run1.csv") == "c:/lab/data/run1.csv"


def test_path_key_unc() -> None:
    assert path_key("\\\\server\\share\\run1.csv") == "server/share/run1.csv"


def test_path_key_mixed_separators_equal() -> None:
    assert path_key("a\\b/c.csv") == path_key("a/b/c.csv")


def test_path_key_trailing_separators_equal() -> None:
    assert path_key("/data/run1/") == path_key("/data/run1")


def test_path_key_case_insensitive() -> None:
    assert path_key("/Data/Run1.CSV") == path_key("/data/run1.csv")


def test_path_key_nfc_vs_nfd_unicode_equal() -> None:
    composed = "\u00e9"  # 'é' as one codepoint (NFC)
    decomposed = "e\u0301"  # 'e' + combining acute accent (NFD)
    assert path_key(f"/data/{composed}.csv") == path_key(f"/data/{decomposed}.csv")


# ── sanitize_component ──────────────────────────────────────────────────


def test_sanitize_component_already_safe_unchanged() -> None:
    assert sanitize_component("run1.csv") == ("run1.csv", None)


def test_sanitize_component_illegal_characters() -> None:
    name, reason = sanitize_component('a<b>c:d"e|f?g*h.csv')
    assert reason == "illegal_characters"
    assert set('<>:"|?*') & set(name) == set()


def test_sanitize_component_control_characters() -> None:
    name, reason = sanitize_component("a\x00b\x1fc\x7fd.csv")
    assert reason == "illegal_characters"
    assert "\x00" not in name and "\x1f" not in name and "\x7f" not in name


@pytest.mark.parametrize("reserved", ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9"])
def test_sanitize_component_reserved_names_bare(reserved: str) -> None:
    name, reason = sanitize_component(reserved)
    assert reason == "reserved_name"
    assert name == f"_{reserved}"


@pytest.mark.parametrize("reserved", ["con", "Con", "com3", "lpt5"])
def test_sanitize_component_reserved_names_case_insensitive(reserved: str) -> None:
    _, reason = sanitize_component(reserved)
    assert reason == "reserved_name"


def test_sanitize_component_reserved_name_with_extension() -> None:
    name, reason = sanitize_component("CON.csv")
    assert reason == "reserved_name"
    assert name == "_CON.csv"


def test_sanitize_component_reserved_name_not_a_prefix_match() -> None:
    # "CONSOLE.csv" is not the reserved name "CON" -- only an exact stem match.
    name, reason = sanitize_component("CONSOLE.csv")
    assert reason is None
    assert name == "CONSOLE.csv"


def test_sanitize_component_trailing_dot_or_space() -> None:
    name, reason = sanitize_component("run1.csv. ")
    assert reason == "trailing_dot_or_space"
    assert name == "run1.csv"


@pytest.mark.parametrize("name", ["", ".", ".."])
def test_sanitize_component_empty_or_dot_segments(name: str) -> None:
    result, reason = sanitize_component(name)
    assert result == "_"
    assert reason == "empty"


def test_sanitize_component_all_dots_and_spaces_becomes_empty() -> None:
    result, reason = sanitize_component(". . .")
    assert result == "_"
    assert reason is not None
    assert "empty" in reason


def test_sanitize_component_too_long_keeps_extension() -> None:
    long_name = ("a" * 300) + ".csv"
    name, reason = sanitize_component(long_name)
    assert reason == "too_long"
    assert name.endswith(".csv")
    assert len(name.encode("utf-8")) <= MAX_COMPONENT_BYTES


def test_sanitize_component_too_long_is_deterministic() -> None:
    long_name = ("b" * 300) + ".dat"
    first, _ = sanitize_component(long_name)
    second, _ = sanitize_component(long_name)
    assert first == second


def test_sanitize_component_too_long_different_names_differ() -> None:
    a, _ = sanitize_component(("a" * 300) + ".dat")
    b, _ = sanitize_component(("b" * 300) + ".dat")
    assert a != b


def test_sanitize_component_too_long_unicode_no_mid_codepoint_break() -> None:
    # Multi-byte characters throughout -- truncation must not raise or emit
    # a mangled/invalid string.
    long_name = ("\u00e9" * 150) + ".csv"
    name, reason = sanitize_component(long_name)
    assert reason == "too_long"
    assert len(name.encode("utf-8")) <= MAX_COMPONENT_BYTES
    name.encode("utf-8")  # does not raise


def test_sanitize_component_too_long_extension_alone_truncates_whole_name() -> None:
    # Regression for review finding #3: when the extension ALONE doesn't
    # fit the byte budget, only truncating the stem left the extension
    # intact and the whole name over MAX_COMPONENT_BYTES.
    long_name = "a." + ("y" * 300)
    name, reason = sanitize_component(long_name)
    assert reason == "too_long"
    assert len(name.encode("utf-8")) <= MAX_COMPONENT_BYTES
    assert "~" in name  # still carries the content-hash marker


def test_sanitize_component_reserved_name_multi_dot_extension() -> None:
    # Regression for review finding #6: Windows reserves the name before
    # the FIRST dot ("CON"), not the part before the LAST dot ("CON.tar",
    # which `split_ext` -- extension-preserving truncation's own split --
    # would return for "CON.tar.gz").
    name, reason = sanitize_component("CON.tar.gz")
    assert reason == "reserved_name"
    assert name == "_CON.tar.gz"


def test_sanitize_component_combines_reasons() -> None:
    # A single dot: illegal-char replacement fires on the extension side,
    # and the resulting stem ("CON") still matches a reserved device name.
    name, reason = sanitize_component("CON.c<sv")
    assert reason is not None
    assert "illegal_characters" in reason
    assert "reserved_name" in reason
    assert name == "_CON.c_sv"


# ── split_ext (review finding #10: the one shared implementation) ────────


def test_split_ext_basic() -> None:
    assert split_ext("run1.csv") == ("run1", ".csv")


def test_split_ext_leading_dot_not_an_extension() -> None:
    assert split_ext(".gitignore") == (".gitignore", "")


def test_split_ext_last_dot_wins() -> None:
    assert split_ext("archive.tar.gz") == ("archive.tar", ".gz")


# ── is_bundle_relative / join_bundle_path ────────────────────────────────


@pytest.mark.parametrize(
    "rel",
    [
        "sources/a.csv",
        "sources/sub/a.csv",
        "sources/sub/deeper/a.csv",
    ],
)
def test_is_bundle_relative_accepts(rel: str) -> None:
    assert is_bundle_relative(rel) is True


@pytest.mark.parametrize(
    "rel",
    [
        "../x",
        "sources/../x",
        "sources/./x",
        "/abs",
        "C:/x",
        "c:/x",
        "C:\\x",
        "\\\\srv\\share",
        "//srv/share",
        "sources\\a.csv",
        "sources//a",
        "other/a.csv",
        "sources/a\x00.csv",
        "",
        "sources/",
        "sources/..",
    ],
)
def test_is_bundle_relative_rejects(rel: str) -> None:
    assert is_bundle_relative(rel) is False


@pytest.mark.parametrize(
    "rel",
    [
        "../x",
        "sources/../x",
        "sources/./x",
        "/abs",
        "C:/x",
        "\\\\srv\\share",
        "sources\\a.csv",
        "sources//a",
        "other/a.csv",
        "",
    ],
)
def test_join_bundle_path_raises_on_every_rejected_form(rel: str) -> None:
    with pytest.raises(ValueError):
        join_bundle_path("/bundle", rel)


def test_join_bundle_path_builds_expected_path() -> None:
    result = join_bundle_path("/bundle", "sources/sub/a.csv")
    assert result == os.path.join("/bundle", "sources", "sub", "a.csv")


# Regression for review finding #7: a segment can be a well-formed bare
# path component yet Windows-illegal on its own merits (a colon, an
# illegal character, a reserved device name, a trailing dot) --
# `ntpath.join` would otherwise reinterpret some of these; `is_bundle_relative`
# must reject them outright rather than let `join_bundle_path` build an
# unsafe real path from them.
@pytest.mark.parametrize(
    "rel",
    [
        "sources/D:evil",
        "sources/a<b",
        "sources/CON.csv",
        "sources/x.",
    ],
)
def test_is_bundle_relative_rejects_windows_illegal_segment(rel: str) -> None:
    assert is_bundle_relative(rel) is False


@pytest.mark.parametrize(
    "rel",
    [
        "sources/D:evil",
        "sources/a<b",
        "sources/CON.csv",
        "sources/x.",
    ],
)
def test_join_bundle_path_raises_on_windows_illegal_segment(rel: str) -> None:
    with pytest.raises(ValueError):
        join_bundle_path("/bundle", rel)


def test_join_bundle_path_raises_on_normpath_escape(tmp_path: object) -> None:
    # Even though `is_bundle_relative` should already reject every shape that
    # could escape, the commonpath assertion is a second, independent check.
    # Simulate a bundle_root that itself isn't normalized, to exercise the
    # commonpath comparison path (still resolves safely under it).
    root = "/bundle/../bundle"
    result = join_bundle_path(root, "sources/a.csv")
    assert os.path.normpath(result).startswith(os.path.normpath("/bundle"))
