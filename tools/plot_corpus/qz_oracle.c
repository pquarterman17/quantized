/*
 * Plot-type readback for the plot-corpus oracle (tools/plot_corpus).
 *
 * LabTalk has no property that reports a data plot's type: `plotxy plot:=N`
 * returns success for ANY N (measured 2026-11-15, even N=999), and every
 * `layer.plotN.*` / `get %C -?` value probed was identical across line,
 * column, box and histogram plots. Origin C's DataPlot::GetPlotType() -- the
 * call Origin's own dialogs use (56 call sites under OriginC/OriginLab) --
 * is the readback. origin_session/origin_build compile this file with
 * run.LoadOC("<backslash path>", 16); a forward-slash path or LF-only line
 * endings made LoadOC return 3 (failure) on Origin 2026b Student.
 */
#include <Origin.h>

int qz_ptype(string gname, int ilayer, int iplot)
{
	GraphPage gp(gname);
	if (!gp) return -2;
	GraphLayer gl = gp.Layers(ilayer);
	if (!gl) return -3;
	DataPlot dp = gl.DataPlots(iplot);
	if (!dp) return -4;
	return dp.GetPlotType();
}

int qz_nplots(string gname, int ilayer)
{
	GraphPage gp(gname);
	if (!gp) return -2;
	GraphLayer gl = gp.Layers(ilayer);
	if (!gl) return -3;
	return gl.DataPlots.Count();
}

int qz_nlayers(string gname)
{
	GraphPage gp(gname);
	if (!gp) return -2;
	return gp.Layers.Count();
}
