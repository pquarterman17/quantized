"""Conventions a quantized implementation must use to match Origin, by case id.

Written into each ``truth.json`` as ``conventions``. Filled from measurement
on OriginPro 2026b (10.35), never from the documentation. Where the fixture
was checked against numpy / scipy / PyWavelets the residual is stated; where a
rule was not pinned that is stated too ("NOT pinned").
"""

from __future__ import annotations

from typing import Any

_KM_LAYOUT = (
    "Report sheet ClusterN (read by column position): per-variable Data/Range/Mean/"
    "Standard Deviation/N analysis/N missing, then 4 initial-centre columns (rows = clusters), "
    "4 final-centre columns, then Number of Observations, Within Cluster Sum of Square, Average "
    "Distance, Maximum Distance, a k x k centre-distance block, ANOVA columns. 'Cluster "
    "MembershipN' holds Membership (1-based) and Distance."
)
_KM_ALGO = {
    "algorithm": "plain Lloyd iteration (assign to nearest centre by Euclidean distance, "
    "recompute means) to convergence; verified labels and centres equal to a numpy Lloyd "
    "run from Origin's own initial centres (error 0.0).",
    "standardise": "std none: raw. snd: (x - mean) / sd with sd ddof=1. range: (x - min) / "
    "(max - min). Centres, distances, WSS and ANOVA are all in the STANDARDISED space "
    "(final centres match the standardised-space means to 1e-15, not the raw means).",
    "distance_column": "Euclidean (not squared) distance from the observation to its own "
    "cluster centre, in the standardised space.",
    "seed": "no seed option; the run is deterministic (three identical runs gave identical "
    "initial centres, labels and centres).",
    "labels": "1-based, numbered by the order of Origin's initial centres, which is NOT "
    "recoverable from a quantized rule; compare partitions up to relabelling.",
    "layout": _KM_LAYOUT,
}
_HC_REPORT = (
    "Report sheet ClusterN: [dissimilarity matrix columns named 1..n when dissimilarity:=1], "
    "Stage, Distance (merge height), Cluster1, Cluster2 (ids merged), Number of Clusters, New "
    "Cluster, Next Stage, then the cut table (Cluster, Count, centres). 'Cluster "
    "MembershipN' holds the cut membership, 1-based, numbered by first appearance in row order."
)

CONVENTIONS: dict[str, dict[str, Any]] = {
    "kmeans_default_init": {
        **_KM_ALGO,
        "initial_centres": "default initialisation picks observations (rows of the "
        "standardised data) deterministically: for this seed rows (0-based) [52, 9, 14] with "
        "std none and [12, 9, 14] with snd and range; each initial centre equals a data row "
        "exactly. The rule is NOT pinned (see kmeans_init_rule); to match Origin, pass these "
        "rows as explicit initial centres.",
        "steps": "step k = ClusterK + Cluster MembershipK sheets: 1 none, 2 snd, 3 range.",
    },
    "kmeans_init_rule": {
        **_KM_ALGO,
        "initial_centres": "0-based data rows chosen by default (std none): k=2 [50, 4]; k=4 "
        "[56, 1, 50, 4]; k=5 [55, 17, 50, 59, 4]. NOT pinned: farthest-first (maximin) "
        "traversal reproduces the SET for k<=4 from some start row but not for k=5, and no "
        "rank-quantile rule on any single variable, sum or norm matched. Treat the default "
        "initialiser as undocumented; match Origin only through explicit initial centres.",
    },
    "kmeans_specified_init": {
        **_KM_ALGO,
        "initial_centres": "specify:=1 with iinitial = the 3 x 4 block (columns c1..c4, rows "
        "1-3). The range must be restricted to the filled rows: [book]1!(5,6,7,8)[1:3]; a "
        "whole-column range returns False.",
        "iterations": "iter:=1 is rejected (Execute False); iter 2, 10 and 100 all gave the "
        "converged result here, equal to numpy Lloyd after 3 passes.",
        "exact_match": "from the same initial centres a numpy Lloyd run reproduces labels and "
        "centres to 0.0: the cleanest kmeans comparison.",
    },
    "hcluster_linkage": {
        "report": _HC_REPORT,
        "distance": "Euclidean on raw variables (obj Observations, dist1 euc, std none).",
        "single_complete_average": "near/furth/group equal scipy.cluster.hierarchy linkage "
        "single/complete/average on Euclidean distances: merge heights to 1e-14.",
        "centroid_median_ward": "NOT scipy. Origin applies the Lance-Williams update directly "
        "to UNSQUARED Euclidean distances: ward d(k,ij) = ((ni+nk) d_ik + (nj+nk) d_jk - nk "
        "d_ij) / (ni+nj+nk); centroid d = (ni d_ik + nj d_jk)/(ni+nj) - ni nj d_ij/(ni+nj)^2; "
        "median d = (d_ik + d_jk)/2 - d_ij/4. Merge heights are the resulting d (no sqrt): "
        "matched to 7e-15 / 0 / 0. scipy's ward/centroid/median (which update squared "
        "distances) differ by up to 287 / 17 / 22 on this data.",
        "cut_rule": "number:=k cuts the tree leaving k clusters (same partition as scipy "
        "fcluster criterion maxclust). Labels are numbered by first appearance in row order.",
        "steps": "step order near, furth, group, centroid, median, ward = sheets Cluster1..6.",
    },
    "hcluster_distance": {
        "report": _HC_REPORT,
        "distances": "dist1 euc/squ/city/cos/corr = scipy pdist euclidean/sqeuclidean/"
        "cityblock/cosine/correlation; the dissimilarity matrices match to 4e-16. Group-"
        "average heights equal scipy average on those matrices (1e-12). squ is squared "
        "Euclidean as the matrix (heights are merged on the squared values).",
        "jaccard": "jac on continuous data returns 1.0 for every off-diagonal pair (equality "
        "based); not meaningful for real-valued variables.",
        "steps": "order euc, squ, city, cos, corr, jac = Cluster1..6.",
    },
    "hcluster_standardise": {
        "report": _HC_REPORT,
        "standardise": "std snd: (x - mean)/sd with ddof=1; range: (x - min)/(max - min), "
        "column-wise over the variables, before the distance. Ward heights match the Lance-"
        "Williams recipe on the standardised data to 5e-15; reported cluster centres are in "
        "the STANDARDISED space (1e-16).",
        "steps": "order none, snd, range = Cluster1..3.",
    },
    "hcluster_variables": {
        "report": _HC_REPORT,
        "variables": "obj:=1 clusters columns. dist2 corr = 1 - r, abs = 1 - |r| (matrices "
        "match numpy corrcoef to 4e-16); average-linkage heights equal scipy average on the "
        "matrix. Membership holds the variable names and cluster ids. The seeded data make "
        "v3 anti-correlated with v1: corr puts {v1, v2} and {v3, v4}, abs puts {v1, v2, v3} "
        "and {v4}.",
    },
    "hcluster_dendrogram": {
        "report": _HC_REPORT,
        "plot_data": "'Cluster Plot Data1' holds the dendrogram: Observations (leaf order and "
        "node x), Distance (node y), Group, Label. Leaf order [6, 7, 9, 10, 4, 5, 13, 8, 11, "
        "12, 2, 3, 1, 14 ...] is Origin's layout; agreement with scipy dendrogram leaves NOT "
        "tested.",
    },
    "cwt_wavelets": {
        "layout": "256 samples y (column 2), 12 scales (column 3, in SAMPLE units), outputs "
        "CWTResultsK sheets of 12 columns (scale order) x 256 rows, real coefficients. "
        "Steps: morlet 5, morlet 8, dgauss 2, mexhat. Pseudo-frequency = C / scale with "
        "C = 208 (morlet 5), 80 (dgauss 2), 64 (mexhat) for this 256-sample record; whether C "
        "depends on N is NOT pinned.",
        "impulse_probe": "probed separately with a unit impulse at index 128: the response is "
        "even about index 128.5 (half-sample offset), a Gaussian-windowed cosine "
        "exp(-x^2/(2 s^2)) cos(w0 x / s) with sigma = s to 1.2 percent at s=2 and 0.03 percent "
        "at s=8, zero sum (admissibility), support about +-7.2 s, amplitude A(s) = 0.534, "
        "0.467, 0.348 at s = 2, 4, 8 (not 1/sqrt(s)). The exact normalisation and the "
        "complex part are NOT pinned: a quantized cwt cannot yet match to better than a few "
        "percent. Treat this fixture as the target, not as a formula.",
    },
    "dwt_single_level": {
        "layout": "ca/cd columns appear in step order: DWT_CA1/CD1 db4 periodic, 2 db4 zero, "
        "3 haar periodic, 4 db2 periodic, 5 bior2.2 periodic. The sheet is 256 rows; read "
        "the non-empty prefix.",
        "zero_padded": "ext Z equals PyWavelets dwt(mode='zero') exactly: length floor((N + "
        "L - 1)/2) = 131 for db4, filters pywt dec_lo / dec_hi.",
        "periodic": "ext P = circular convolution of the signal with pywt dec_lo / dec_hi, "
        "y[n] = sum_k f[k] x[(n - k) mod N], keeping the ODD indices n = 1, 3, 5, ... "
        "(length N/2 = 128). Verified to 1e-15 for db4, db2 and bior2.2; haar is identical "
        "in every mode. NOT pywt 'periodization'.",
        "names": "Type codes: Haar, DB2..DB10, B11..B37 = Bior1.1..Bior3.7 (B22 = bior2.2).",
    },
    "mdwt_levels": {
        "layout": "MDWTk sheet: Approxi<L>, Detail<L>, ..., Detail1 columns, steps db4 L4 "
        "periodic, db4 L4 zero, haar L3, db2 L6.",
        "rule": "repeated single-level dwt of the approximation, same filters and extension "
        "as dwt_single_level: matched to 1e-15 (periodic) and 0.0 (zero-padded, lengths 22, "
        "22, 38, 69, 131).",
    },
    "idwt_roundtrip": {
        "rule": "dwt then idwt reconstructs the 256-sample input to 4e-16 for both periodic "
        "and zero-padded db4 (output length 256, trailing synthesis samples trimmed).",
    },
    "wtdenoise_variants": {
        "layout": "oy outputs are (x, y) column pairs in step order: db4 sqtwolog L4, db4 "
        "sqtwolog L6, db4 custom 50 L4, haar sqtwolog L4, db4 zero-padded sqtwolog L4.",
        "decomposition": "multilevel dwt of the signal with the same filters / periodic "
        "convention as mdwt_levels; the approximation is untouched.",
        "thresholding": "HARD: kept detail coefficients are unchanged (shrinkage 0.0 to "
        "1e-15), the rest are zeroed. One GLOBAL threshold T for all levels 1..level.",
        "custom": "thrt:=custom thrd:=p uses T = (p / 100) * max|d| over the detail "
        "coefficients of levels 1..level (p = 50: T = 0.7129, inside the observed feasible "
        "interval [0.7118, 0.7723]).",
        "sqtwolog": "T = sigma * sqrt(2 ln N) is the textbook rule but sigma is NOT pinned: "
        "the feasible T for db4 level 6 is [1.4259, 3.5213] (level 4: > 1.4259, haar > 1.296), "
        "consistent with sigma in about [0.43, 1.06] (std(y) = 0.76 fits; the MAD of level 1 "
        "details, 0.20, does not).",
        "max_level": "level 7 returns False on 256 samples with db4; level 6 is the maximum.",
    },
    "wtsmooth_cutoff": {
        "layout": "oy outputs are (x, y) column pairs in step order: db4 20, db4 80, db4 95, "
        "haar 80, db4 zero-padded 80.",
        "rule": "decompose to 6 levels (N = 256: detail counts 128, 64, 32, 16, 8, 4 = 252; "
        "haar gives the same counts); budget M = floor(cutoff / 100 * 252). Walk the levels "
        "from 1 (finest) upward and, inside each level, zero coefficients from the LAST index "
        "backwards until M are zeroed (cutoff 20: indices 78-127 of level 1; cutoff 80: all "
        "of levels 1-2 and indices 23-31 of level 3). Kept coefficients and the approximation "
        "are unchanged; reconstruct. It is NOT a magnitude rule (kept coefficients can be "
        "smaller than zeroed ones). Verified to 1e-10 against the numpy reconstruction.",
        "unpinned": "why 6 levels (log2 N - 2 or a filter-length rule), and the zero-padded "
        "variant, were not separately checked.",
    },
    "pss_ttest1": {
        "layout": "input columns size (8) and power (5); result columns appended per call: "
        "'<tag> power at size', 'size for power', 'actual power'. Tags a = two-sided, b = "
        "greater. Engine = ocmath_tTest_powers1 / ocmath_tTest_samplesize (Origin C, because "
        "PSS_tTest1 is menu-only).",
        "power": "noncentral t: nc = (Mean2 - Mean1) / sd * sqrt(n), df = n - 1; two-sided "
        "sf(tc) + cdf(-tc) with tc = t.ppf(1 - alpha/2); greater: sf(t.ppf(1 - alpha)). "
        "scipy nct agrees to 2e-8.",
        "sample_size": "smallest integer n with power >= target; equals the scipy search "
        "([25, 48, 63, 77, 108] two-sided).",
    },
    "pss_ttest2": {
        "layout": "as pss_ttest1; tags a (two-sided), b (greater). Extra '(alt)' columns are "
        "the older ocmath_two_sample_tTest_samplesize route.",
        "power": "noncentral t with df = 2n - 2, nc = (Mean1 - Mean2) / sd * sqrt(n / 2), n "
        "PER GROUP. Two-sided matches scipy nct to 4e-9. DIRECTION: 'greater' means Mean1 > "
        "Mean2, so with Mean1 = 0 < Mean2 = 1 the power is tiny (0.0005 at the first size) "
        "and the alt route returns NaN (error -225): that is the convention, not a defect.",
        "sample_size": "the default menu route (ocmath_get_sample_size_for_two_sample_t_test) "
        "takes only two-sided yes/no and ignores the direction: [19, 37, 49, 60, 84] two-sided "
        "and [13, 29, 40, 50, 72] one-sided (both = smallest integer n by scipy nct).",
    },
    "pss_ttestpair": {
        "layout": "as pss_ttest1; tags a (two-sided), b (lower: tail 2).",
        "power": "one-sample form on the difference: df = n - 1, nc = (Mean1 - Mean2) / sd * "
        "sqrt(n) with sd the SD of the differences; lower tail = cdf(-tc, nc) with "
        "tc = t.ppf(1 - alpha). Two-sided matches scipy nct to 1e-8.",
        "sample_size": "smallest integer n: [14, 27, 35, 42, 59] two-sided; lower tail "
        "[10, 21, 28, 35, 50] (direction Mean1 < Mean2).",
    },
    "pss_anova1": {
        "layout": "input columns size (per group) and power; result columns 'a power at "
        "size', 'a size for power', 'a actual power'. Engine = ocmath_anova_powers1 / "
        "ocmath_anova_samplesize.",
        "power": "noncentral F: df1 = k - 1, df2 = k (n - 1), noncentrality = n * CSS / sd^2 "
        "with CSS = sum((group mean - grand mean)^2) (NOT multiplied by k); scipy ncf "
        "agrees to 7e-8. For 'maximum difference' input Origin uses CSS = d^2 / 2.",
        "sample_size": "smallest integer n per group: [20, 36, 46, 55, 75].",
    },
    "ttest2_pooled_welch": {
        "layout": "scalar variables ts/df/pr/lo/up for steps 1..4: pooled two-sided, Welch "
        "two-sided, pooled upper, Welch upper.",
        "tests": "equal:=1 is the pooled-variance Student test (df = n1 + n2 - 2), equal:=0 "
        "is Welch with Satterthwaite df; statistics and P match scipy ttest_ind to 1e-15 "
        "for both and both tails.",
        "quirk": "the confidence limits (lcl / ucl) are the POOLED interval even when equal:=0: "
        "Welch two-sided limits (-3.6418, 0.2068) equal the pooled ones, scipy's Welch "
        "interval is (-3.8762, 0.4412). For a one-sided tail the limits are the two-sided "
        "interval at confidence 1 - 2 alpha (t quantile 1 - alpha).",
    },
}
