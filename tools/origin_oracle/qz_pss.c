/*
 * Power and sample size, called straight into Origin's own engine.
 *
 * Why Origin C: PSS_tTest1, PSS_tTest2, PSS_tTestPair and PSS_ANOVA1 are
 * <LabTalk>0</LabTalk> in their OXF (menu-only), so every Execute form returns
 * False. Each X-Function body calls the ocmath_* routines used below with the
 * same arguments (see the OXF code sections), so these wrappers are the menu
 * command minus the report.
 *
 * Input book (the harness writes it): column 1 = hypothetical sample sizes,
 * column 2 = hypothetical powers, both on sheet 1. Each call appends result
 * columns to that sheet, named "<tag> <what>":
 *   power at size          power for each sample size (ocmath_*_powers1)
 *   size for power         sample size for each power, the default menu route
 *   actual power           power at that integer size (ocmath_*_powers1)
 *   size for power (alt)   the older ocmath_*_samplesize route (@PSSCI = 1)
 *
 * qz_pss_t(kind: 1 one-sample, 2 two-sample, 3 paired; tail: 0 two-sided,
 * 1 greater, 2 less). mean1 / mean2 are Mean1 / Mean2 of PowerOpts (null and
 * alternative mean for the one-sample test). qz_pss_anova uses the one-way
 * ANOVA wrapper with CSS = sum((group mean - grand mean)^2).
 */
#include <Origin.h>

static int qz_trim(vector &v)
{
	int n = v.GetSize();
	while (n > 0 && is_missing_value(v[n - 1])) n--;
	return n;
}

static void qz_put(Worksheet &wks, string name, vector &v, int n)
{
	int c = wks.AddCol(name);
	Column col(wks, c);
	col.SetLongName(name);
	Dataset ds(wks, c);
	vector o(n);
	for (int i = 0; i < n; i++) o[i] = v[i];
	ds = o;
}

int qz_pss_t(string book, int kind, double mean1, double mean2, double sd,
	double alpha, int tail, string tag)
{
	WorksheetPage wp(book);
	if (!wp) return -1;
	Worksheet wks = wp.Layers(0);
	if (!wks) return -2;
	Dataset dsz(wks, 0), dpw(wks, 1);
	vector sizes = dsz, powers = dpw;
	int ns = qz_trim(sizes), np = qz_trim(powers);
	PowerOpts po;
	po.Mean1 = mean1;
	po.Mean2 = mean2;
	po.SD = sd;
	HypotTestOptions ho;
	ho.HypotValue = 1;
	ho.TailType = tail;
	vector pw(ns), sz(np), act(np), sz2(np), act2(np);
	pw = NANUM; sz = NANUM; act = NANUM; sz2 = NANUM; act2 = NANUM;
	double lowest = 0;
	int r1 = 0, r2 = 0, r3 = 0, r4 = 0;
	if (kind == 1)
	{
		r1 = ocmath_tTest_powers1(alpha, tail, sizes, ns, &po, pw);
		r2 = ocmath_tTest_samplesize(alpha, tail, powers, np, &po, sz2, &lowest);
		sz = sz2;
		r3 = ocmath_tTest_powers1(alpha, tail, sz, np, &po, act);
	}
	else if (kind == 2)
	{
		r1 = ocmath_two_sample_tTest_powers1(alpha, &ho, sizes, ns, &po, pw);
		r2 = ocmath_get_sample_size_for_two_sample_t_test(sz, mean1, mean2, sd, powers, np,
			alpha, tail == TAILED_TEST_TWO);
		r3 = ocmath_two_sample_tTest_powers1(alpha, &ho, sz, np, &po, act);
		r4 = ocmath_two_sample_tTest_samplesize(alpha, &ho, powers, np, &po, sz2, &lowest);
		ocmath_two_sample_tTest_powers1(alpha, &ho, sz2, np, &po, act2);
	}
	else
	{
		r1 = ocmath_two_sample_tTest_powers_pair1(alpha, &ho, sizes, ns, &po, pw);
		r2 = ocmath_get_sample_size_for_paired_sample_t_test(sz, mean1, mean2, sd, powers, np,
			alpha, tail);
		r3 = ocmath_two_sample_tTest_powers_pair1(alpha, &ho, sz, np, &po, act);
		r4 = ocmath_two_sample_tTest_samplesize_pair(alpha, &ho, powers, np, &po, sz2, &lowest);
		ocmath_two_sample_tTest_powers_pair1(alpha, &ho, sz2, np, &po, act2);
	}
	qz_put(wks, tag + " power at size", pw, ns);
	qz_put(wks, tag + " size for power", sz, np);
	qz_put(wks, tag + " actual power", act, np);
	if (kind != 1)
	{
		qz_put(wks, tag + " size for power (alt)", sz2, np);
		qz_put(wks, tag + " actual power (alt)", act2, np);
	}
	LT_set_var(tag + "_r1", r1); LT_set_var(tag + "_r2", r2);
	LT_set_var(tag + "_r3", r3); LT_set_var(tag + "_r4", r4);
	return 0;
}

int qz_pss_anova(string book, double levels, double css, double sd, double alpha, string tag)
{
	WorksheetPage wp(book);
	if (!wp) return -1;
	Worksheet wks = wp.Layers(0);
	if (!wks) return -2;
	Dataset dsz(wks, 0), dpw(wks, 1);
	vector sizes = dsz, powers = dpw;
	int ns = qz_trim(sizes), np = qz_trim(powers);
	ANOVAPowerOpts po;
	po.Level = levels;
	po.CSS = css;
	po.SD = sd;
	vector pw(ns), sz(np), act(np);
	pw = NANUM; sz = NANUM; act = NANUM;
	int r1 = ocmath_anova_powers1(alpha, sizes, ns, &po, pw);
	int r2 = ocmath_anova_samplesize(alpha, powers, np, &po, sz);
	int r3 = ocmath_anova_powers1(alpha, sz, np, &po, act);
	qz_put(wks, tag + " power at size", pw, ns);
	qz_put(wks, tag + " size for power", sz, np);
	qz_put(wks, tag + " actual power", act, np);
	LT_set_var(tag + "_r1", r1); LT_set_var(tag + "_r2", r2); LT_set_var(tag + "_r3", r3);
	return 0;
}
