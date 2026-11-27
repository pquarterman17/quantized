"""Wave-6 oracle cases: clustering, wavelets, power and sample size, t-tests.

Same registry contract as ``oracle_cases``. ``{book}`` becomes the input
book's short name; every step is one ``Execute``. Conventions a quantized
implementation must use to match are in ``oracle_conventions`` and are
written into each ``truth.json``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

import oracle_inputs_cluster as g
from oracle_conventions import CONVENTIONS
from oracle_model import Case, InputSpec, Read

B = "[{book}]1!"
KM = f"kmeans ir:={B}1:4 num:=3"
Y = f"{B}2"
SCALE = f"{B}3"


def _hc(extra: str) -> str:
    return f"hcluster irng:={B}1:3 {extra};"


def _case(
    cid: str,
    desc: str,
    seed: int,
    gen: Callable[[Any], InputSpec],
    steps: Iterable[str],
    **kw: Any,
) -> Case:
    return Case(id=cid, description=desc, seed=seed, generate=gen, steps=tuple(steps),
                conventions=CONVENTIONS.get(cid, {}), **kw)


def _pss(kind: int, tail: int, m1: float, m2: float, sd: float, tag: str) -> str:
    return (f'double qz{tag} = qz_pss_t("{{book}}", {kind}, {m1}, {m2}, {sd}, 0.05, {tail}, '
            f'"{tag}");')


_PSS_READS = tuple(Read(f"{t}_r{i}") for t in ("a", "b") for i in (1, 2, 3, 4))

CLUSTER_CASES: tuple[Case, ...] = (
    _case(
        "kmeans_default_init",
        "kmeans, 3 clusters of 60 x 4 blobs: no standardisation, z scores, range [0,1]; "
        "ANOVA + distances",
        140, g.three_blobs,
        [f"{KM} std:={s} anova:=1 distance:=1 clusterPlot:=0;" for s in ("none", "snd", "range")],
    ),
    _case(
        "kmeans_init_rule",
        "kmeans default initial centres for 2, 4 and 5 clusters (no standardisation)",
        141, g.three_blobs,
        [f"kmeans ir:={B}1:4 num:={k} std:=none clusterPlot:=0;" for k in (2, 4, 5)],
    ),
    _case(
        "kmeans_specified_init",
        "kmeans from user-specified initial centres: iter 2, 10 (default), 100",
        142, g.blobs_with_initial_centres,
        [f"kmeans ir:={B}1:4 specify:=1 iinitial:={B}(5,6,7,8)[1:3] iter:={n} std:=none "
         "clusterPlot:=0;"
         for n in (2, 10, 100)],
    ),
    _case(
        "hcluster_linkage",
        "hcluster of 12 x 3 observations, Euclidean, every linkage, 3 clusters",
        143, g.small_obs,
        [_hc(f"number:=3 link:={m} dendrogram:=0") for m in
         ("near", "furth", "group", "centroid", "median", "ward")],
    ),
    _case(
        "hcluster_distance",
        "hcluster group-average linkage with every observation distance; dissimilarity matrices",
        144, g.small_obs,
        [_hc(f"number:=3 link:=group dist1:={d} dissimilarity:=1 dendrogram:=0")
         for d in ("euc", "squ", "city", "cos", "corr", "jac")],
    ),
    _case(
        "hcluster_standardise",
        "hcluster Ward: no standardisation, z scores and range [0,1], with cluster centres",
        145, g.small_obs,
        [_hc(f"number:=3 link:=ward std:={s} center:=1 distc2c:=1 dendrogram:=0")
         for s in ("none", "snd", "range")],
    ),
    _case(
        "hcluster_variables",
        "hcluster of the 4 variables (obj:=1): correlation and absolute correlation distance",
        146, g.variables_mixed,
        [f"hcluster irng:={B}1:4 obj:=1 number:=2 link:=group dist2:={d} dissimilarity:=1 "
         "dendrogram:=0;"
         for d in ("corr", "abs")],
    ),
    _case(
        "hcluster_dendrogram",
        "hcluster Ward with the dendrogram plot data (leaf order, node coordinates)",
        147, g.small_obs,
        [_hc("number:=3 link:=ward dendrogram:=1")],
    ),
    _case(
        "cwt_wavelets",
        "cwt of a 256-sample tone + burst at 12 scales: Morlet 5 and 8, DGauss 2, MexHat",
        148, g.wavelet_signal,
        [f"cwt ix1:={Y} ix2:={SCALE} type:={t} param:={p} plot:=0 upf:=1 pf:=<new> "
         "rcoef:=<new>!1;"
         for t, p in (("morlet", 5), ("morlet", 8), ("dgauss", 2), ("mexhat", 5))],
    ),
    _case(
        "dwt_single_level",
        "dwt one level: db4 periodic and zero-padded, haar, db2, bior2.2 "
        "(CA / CD pairs in step order)",
        149, g.wavelet_signal,
        [f"dwt ix:={Y} type:={t} ext:={e} ca:=<new> cd:=<new>;"
         for t, e in (("DB4", "P"), ("DB4", "Z"), ("Haar", "P"), ("DB2", "P"), ("B22", "P"))],
    ),
    _case(
        "mdwt_levels",
        "mdwt multilevel: db4 level 4 periodic and zero-padded, haar level 3, db2 level 6",
        150, g.wavelet_signal,
        [f"mdwt ix:={Y} type:={t} ext:={e} level:={n};"
         for t, e, n in (("db4", "periodic", 4), ("db4", "pad0", 4), ("haar", "periodic", 3),
                         ("db2", "periodic", 6))],
    ),
    _case(
        "idwt_roundtrip",
        "dwt then idwt (db4, periodic and zero-padded): the reconstruction",
        151, g.wavelet_signal,
        [f"dwt ix:={Y} type:=DB4 ext:=P ca:=<new> cd:=<new>;",
         f"idwt ca:={B}4 cd:={B}5 type:=DB4 ext:=P ox:=<new>;",
         f"dwt ix:={Y} type:=DB4 ext:=Z ca:=<new> cd:=<new>;",
         f"idwt ca:={B}7 cd:={B}8 type:=DB4 ext:=Z ox:=<new>;"],
    ),
    _case(
        "wtdenoise_variants",
        "wtdenoise: sqtwolog db4 level 4 and 6, custom 50 percent, haar, zero-padded",
        152, g.wavelet_signal,
        [f"wtdenoise iy:={B}(1,2) type:={t} ext:={e} thrt:={th} level:={lv} {x} oy:=<new>;"
         for t, e, th, lv, x in (
             ("db4", "periodic", "sqtwolog", 4, ""), ("db4", "periodic", "sqtwolog", 6, ""),
             ("db4", "periodic", "custom", 4, "thrd:=50"),
             ("haar", "periodic", "sqtwolog", 4, ""), ("db4", "pad0", "sqtwolog", 4, ""))],
    ),
    _case(
        "wtsmooth_cutoff",
        "wtsmooth: db4 cutoff 20 (default), 80, 95; haar cutoff 80; zero-padded db4 80",
        153, g.wavelet_signal,
        [f"wtsmooth iy:={B}(1,2) type:={t} ext:={e} cutoff:={c} oy:=<new>;"
         for t, e, c in (("db4", "periodic", 20), ("db4", "periodic", 80),
                         ("db4", "periodic", 95), ("haar", "periodic", 80),
                         ("db4", "pad0", 80))],
    ),
    _case(
        "pss_ttest1",
        "One-sample t power and sample size (engine of PSS_tTest1): null 0, alt 0.5, sd 1.2",
        154, g.power_grid,
        [_pss(1, 0, 0, 0.5, 1.2, "a"), _pss(1, 1, 0, 0.5, 1.2, "b")],
        load_oc=("qz_pss.c",), reads=_PSS_READS,
    ),
    _case(
        "pss_ttest2",
        "Two-sample t power and sample size (engine of PSS_tTest2): means 0 and 1, sd 1.5",
        155, g.power_grid,
        [_pss(2, 0, 0, 1, 1.5, "a"), _pss(2, 1, 0, 1, 1.5, "b")],
        load_oc=("qz_pss.c",), reads=_PSS_READS,
    ),
    _case(
        "pss_ttestpair",
        "Paired t power and sample size (engine of PSS_tTestPair): means 10 and 10.8, "
        "sd of diff 1.4",
        156, g.power_grid,
        [_pss(3, 0, 10, 10.8, 1.4, "a"), _pss(3, 2, 10, 10.8, 1.4, "b")],
        load_oc=("qz_pss.c",), reads=_PSS_READS,
    ),
    _case(
        "pss_anova1",
        "One-way ANOVA power and sample size (engine of PSS_ANOVA1): 4 groups, CSS 2, sd 2.5",
        157, g.power_grid,
        ['double qza = qz_pss_anova("{book}", 4, 2, 2.5, 0.05, "a");'],
        load_oc=("qz_pss.c",), reads=(Read("a_r1"), Read("a_r2"), Read("a_r3")),
    ),
    _case(
        "ttest2_pooled_welch",
        "ttest2 on two unequal samples: pooled (equal 1) and Welch (equal 0), two-sided and upper",
        158, g.two_groups_unequal,
        [f"ttest2 irng:=({B}1,{B}2) equal:={e} tail:={t} stat:=ts{i} df:=df{i} prob:=pr{i} "
         f"lcl:=lo{i} ucl:=up{i};"
         for i, (e, t) in enumerate(((1, "two"), (0, "two"), (1, "upper"), (0, "upper")),
                                    start=1)],
        reads=tuple(Read(f"{n}{i}") for i in (1, 2, 3, 4) for n in ("ts", "df", "pr", "lo", "up")),
    ),
    _case(
        "pss_proportion",
        "Power and sample size for one- and two-sample proportion tests: no callable engine",
        159, g.power_grid, [],
        not_exercised=(
            "PSS_proportionTest1 / PSS_proportionTest2 are <LabTalk>0</LabTalk> (every Execute "
            "form returns False) and, unlike the t-test and ANOVA siblings, their bodies call no "
            "ocmath_* function: the maths lives inside PssProportionTestReportHelper "
            "(report_utils.h). An Origin C wrapper constructing the helper with a local "
            "ReportData / ReportTree and calling CalcPower / CalcSampleSize did not compile "
            "(run.LoadOC failed; the compiler message is not surfaced over COM)",
        ),
    ),
)

_SCAN = (
    "searched the whole OriginPro 2026b install (3,410 text and binary files: X-Functions, "
    "Origin C, localisation tables, menus, DLLs; ASCII and UTF-16) for {terms}: no match, "
    "while the controls \"Dunn's Test\" and \"Cohen's d\" are found by the same scan"
)


def _absent(cid: str, desc: str, seed: int, terms: str) -> Case:
    return _case(cid, desc, seed, g.power_grid, [], not_exercised=(_SCAN.format(terms=terms),))


ABSENT_CASES: tuple[Case, ...] = (
    _absent("mann_kendall", "Mann-Kendall trend test: absent from the install", 160,
            '"Mann-Kendall" / "Mann Kendall" (only Mann-Whitney and Kendall correlation exist)'),
    _absent("steel_dwass", "Steel-Dwass multiple comparison: absent from the install", 161,
            '"Steel-Dwass" / "Steel Dwass" (kwanova offers only the Dunn post hoc test)'),
    _absent("anova_effect_size",
            "ANOVA effect sizes (eta squared, omega squared): absent from the install", 162,
            '"Eta Squared", "Omega Squared", "Partial Eta" (ANOVAOneWay is operation-only with '
            "no LabTalk form; only the t-tests report Cohen's d)"),
    _absent("probability_calculator", "Probability calculator: absent from the install", 163,
            '"Probability Calculator" (only the plot_prob probability plot and the LabTalk '
            "distribution functions exist)"),
)
