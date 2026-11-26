/*
 * York line fit with per-point X and Y errors, called straight into Origin's
 * own engine (the routine behind Analysis > Fitting > Fit Linear with X Error).
 *
 * Why Origin C: the X-Function FitLRXErr is <LabTalk>0</LabTalk> in its OXF
 * (menu-only), so Execute("FitLRXErr ...") returns False in every form tried.
 * FitLinear.cpp's linearFitXYError() calls exactly this routine for method
 * "York" (ocmath_linear_fit_xyerror_york2003, correlation r = 0, 500 iters),
 * with FitParameter[0] = intercept and FitParameter[1] = slope.
 *
 * Input book layout (the harness writes it): A = x, B = y, C = y error,
 * D = x error, all on sheet 1. Results go to LabTalk variables.
 */
#include <Origin.h>

int qz_york_fit(string book, double conf)
{
	WorksheetPage wp(book);
	if (!wp) return -1;
	Worksheet wks = wp.Layers(0);
	if (!wks) return -2;
	Dataset dx(wks, 0), dy(wks, 1), dye(wks, 2), dxe(wks, 3);
	vector vx = dx, vy = dy, vye = dye, vxe = dxe;
	int n = vx.GetSize();
	vector vr(n);
	vr = 0;
	FitParameter fp[2];
	RegStats rs;
	matrix mCov, mCorr;
	mCov.SetSize(2, 2);
	mCorr.SetSize(2, 2);
	int ret = ocmath_linear_fit_xyerror_york2003(vx, vy, vxe, vye, vr, n, fp, &rs,
		mCov, mCorr, 2, 2, 500, conf);
	LT_set_var("qz_ret", ret);
	LT_set_var("qz_n", n);
	LT_set_var("qz_intercept", fp[0].Value);
	LT_set_var("qz_intercept_err", fp[0].Error);
	LT_set_var("qz_slope", fp[1].Value);
	LT_set_var("qz_slope_err", fp[1].Error);
	LT_set_var("qz_slope_lcl", fp[1].LCL);
	LT_set_var("qz_slope_ucl", fp[1].UCL);
	LT_set_var("qz_dof", rs.DOF);
	LT_set_var("qz_chisq", rs.SSR);
	LT_set_var("qz_redchisq", rs.ReducedChiSq);
	LT_set_var("qz_rsq", rs.RSqCOD);
	LT_set_var("qz_cov_ab", mCov[0][1]);
	return ret;
}
