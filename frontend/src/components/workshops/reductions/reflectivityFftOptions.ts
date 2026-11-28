// Reflectivity FFT: the choices its section offers, in one place so the selects
// that render them and the preset adapter that accepts them cannot drift. The
// window list is Film thickness (FFT)'s: one list, two methods.

import { FFT_THICKNESS_WINDOWS } from "./fftThicknessOptions";
import type { ReflFftPreprocess } from "./reductionRequests";

export const REFLECTIVITY_FFT_WINDOWS = FFT_THICKNESS_WINDOWS;

export const REFLECTIVITY_FFT_PREPROCESS: readonly { value: ReflFftPreprocess; label: string }[] = [
  { value: "logR", label: "log R" },
  { value: "logRQ4", label: "log(R·Q⁴)" },
  { value: "R", label: "R" },
  { value: "RQ4", label: "R·Q⁴" },
];
