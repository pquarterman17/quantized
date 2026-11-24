// Palette-only "deep link" commands: operations people look for by NAME that
// otherwise live behind a dialog's own picker — Normalize, Derivative,
// Integrate, Smooth (all inside Signal Processing), Export PDF / SVG (a format
// answer inside Export figure…), Log Y / Linear Y (a cycle button), Error bars
// (a collapsed Inspector card). Each opens the dialog ON that operation.
//
// `paletteOnly` keeps most of them out of the menus: the menu already has the
// parent command ("Signal Processing…"), and a dozen extra rows would bury it.
// Exceptions with a menu home (UX audit 12): the Normalize rows (Analyze >
// Normalize), Export PDF / SVG / PNG (File > Export, via PLACEMENT) and the
// Log / Linear axis scales (Plot > Axes). Everything stays in the palette and
// in Help, where search is the way in. No duplicated logic: every run only SEEDS the existing dialog
// (`store/signalOperationSeed.ts`, `runExportFigureCommand`'s `fmt`,
// `setYScale`, `lib/revealInspectorCard.ts`).
//
// Lazy-only, like commands/analysisCommands.ts: `buildAppActions` is the one
// importer, so the descriptions below never ship in the entry chunk.

import type { StoreGet } from "../lib/exportActive";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { Action } from "../store/commands";
import { useSignalOperationSeed } from "../store/signalOperationSeed";
import { toast } from "../store/toasts";
import { inspectorShown, toggleInspector } from "../store/inspectorToggle";

function signal(id: string, op: string, label: string, description: string, keywords: string, s: StoreGet): Action {
  // The Normalize rows have a menu home (Analyze > Normalize); the rest stay search-only.
  const normalize = id.startsWith("normalize-");
  return {
    id: `signal-${id}`,
    group: "Analyze",
    section: normalize ? "Normalize" : "Transform & signal",
    label,
    description,
    keywords,
    paletteOnly: !normalize,
    run: () => {
      useSignalOperationSeed.getState().request(op);
      s().setSignalProcessingOpen(true);
    },
  };
}

function exportAs(id: string, fmt: string, label: string, description: string, keywords: string, s: StoreGet): Action {
  return {
    id: `export-${id}`,
    group: "Plot",
    section: "Build & export",
    label,
    description,
    keywords,
    run: () =>
      void runLazy("Loading figure export…", () => import("../lib/exportFigureCommand")).then(
        (m) => m.runExportFigureCommand(s, undefined, fmt),
        onLoadFailure,
      ),
  };
}

function axisScale(id: string, axis: "x" | "y", scale: "linear" | "log", s: StoreGet): Action {
  const A = axis.toUpperCase();
  const log = scale === "log";
  return {
    id: `scale-${id}`,
    group: "Plot",
    section: "Axes",
    label: `${log ? "Log" : "Linear"} ${A} scale`,
    // "X"/"Y" axis, not vertical/horizontal: an exchanged axis keeps its own scale.
    // On Y, a secondary axis with a scale of its own keeps it; one without follows.
    description: log
      ? `Show the ${A} axis on a logarithmic scale${axis === "y" ? "; a secondary Y axis with its own scale keeps it" : ""}.`
      : `Return the ${A} axis to a linear scale${axis === "y" ? "; a secondary Y axis with its own scale keeps it" : ""}.`,
    keywords: log ? "logarithmic semilog loglog decades axis" : "reset axis normal",
    run: () => {
      // Already there: no undo step and no macro line for a change that changes nothing.
      if ((axis === "y" ? s().yScale : s().xScale) === scale) {
        s().setStatus(`${A} axis is already ${scale}`);
        return;
      }
      if (axis === "y") s().setYScale(scale);
      else s().setXScale(scale);
    },
  };
}

/** The palette-only deep-link commands, built against the live store handle. */
export function buildDiscoveryCommands(s: StoreGet): Action[] {
  return [
    signal("normalize-peak", "normalize-peak", "Normalize · peak = 1", "Divide the selected signal by its maximum so the tallest point is 1, with a live preview.", "normalise scale unit height maximum", s),
    signal("normalize-range", "normalize-range", "Normalize · 0–1", "Rescale the selected signal so its minimum is 0 and its maximum is 1, with a live preview.", "normalise min max rescale unit range", s),
    signal("normalize-zscore", "normalize-zscore", "Normalize · Z-score", "Subtract the mean and divide by the standard deviation, with a live preview.", "normalise standardize standard score mean sd", s),
    signal("normalize-area", "normalize-area", "Normalize · area = 1", "Scale the selected signal so the area under it is 1, with a live preview.", "normalise integral unit area", s),
    signal("normalize-reference", "normalize-reference", "Normalize · reference", "Divide the selected signal by a reference value or X range, with a live preview.", "normalise divide reference level", s),
    signal("derivative", "derivative-first", "Derivative · dY/dX", "Differentiate the selected signal with respect to X, with a live preview.", "differentiate slope gradient rate of change dydx", s),
    signal("derivative-2", "derivative-second", "Derivative · d²Y/dX²", "Take the second derivative of the selected signal with respect to X, with a live preview.", "differentiate second curvature d2y", s),
    signal("derivative-log", "log-derivative", "Derivative · dlog(Y)/dlog(X)", "Take the logarithmic derivative, the local power-law exponent, with a live preview.", "differentiate log slope exponent power law", s),
    signal("integrate", "integral", "Integrate · cumulative ∫Y dx", "Integrate the selected signal cumulatively over X, with a live preview.", "integral area under curve cumulative trapezoid antiderivative", s),
    signal("smooth", "smooth", "Smooth…", "Smooth noise with a Savitzky–Golay, moving-average or Gaussian window, with a live preview.", "savitzky golay moving average gaussian denoise noise filter", s),
    signal("detrend", "detrend", "Detrend…", "Remove a polynomial trend from the selected signal, with a live preview.", "polynomial linear drift remove trend", s),
    signal("fft", "fft", "FFT · spectrum / PSD / phase", "Compute the Fourier spectrum, power spectral density or phase of the selected signal.", "fourier frequency power spectral density spectrum", s),
    signal("filter", "filter", "Filter · frequency domain", "Apply a low-pass, high-pass, band-pass or notch filter in the frequency domain.", "lowpass highpass bandpass notch fourier", s),
    signal("correlation", "correlation", "Cross-correlation…", "Correlate the selected signal with itself or with a column of another worksheet.", "autocorrelation lag correlate", s),
    signal("despike", "despike", "Despike · median / MAD", "Replace isolated spikes such as cosmic rays with a robust local median.", "cosmic ray spike remove outlier glitch", s),
    signal("median", "median", "Median filter…", "Smooth with a running median that preserves sharp edges.", "running median window edge preserving", s),
    exportAs("pdf", "pdf", "Export PDF…", "Export the current plot as a vector PDF, choosing style, size and labels first.", "vector publication figure save print", s),
    exportAs("svg", "svg", "Export SVG…", "Export the current plot as an editable vector SVG, choosing style, size and labels first.", "vector publication figure save inkscape illustrator", s),
    exportAs("png", "png", "Export PNG…", "Export the current plot as a raster PNG at the chosen resolution.", "raster image picture figure save slide", s),
    axisScale("y-log", "y", "log", s),
    axisScale("y-linear", "y", "linear", s),
    axisScale("x-log", "x", "log", s),
    axisScale("x-linear", "x", "linear", s),
    {
      id: "error-bars",
      group: "Plot",
      section: "Axes",
      label: "Error bars…",
      description: "Open the Error columns card to bind, detect or compute the error bars of each plotted series.",
      keywords: "error columns uncertainty sigma standard deviation yerr whiskers",
      paletteOnly: true,
      run: () => {
        // Collapsed, or replaced by a docked analysis window (which this floats).
        if (!inspectorShown()) toggleInspector();
        void runLazy("Opening Error columns…", () => import("../lib/revealInspectorCard")).then(
          (m) =>
            m.revealInspectorCard("Error columns").then((found) => {
              if (found) return;
              toast(
                s().activeId
                  ? "The Error columns card is not available for this dataset (it has no columns to bind)."
                  : "Select a dataset to edit its error bars.",
                "info",
              );
            }),
          onLoadFailure,
        );
      },
    },
  ];
}
