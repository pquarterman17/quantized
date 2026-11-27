// Film thickness (FFT): the window choices the section offers, in one place so
// the select that renders them and the preset adapter that accepts them cannot
// drift.

export const FFT_THICKNESS_WINDOWS: readonly { value: string; label: string }[] = [
  { value: "hann", label: "Hann" },
  { value: "blackman", label: "Blackman" },
  { value: "none", label: "None" },
];
