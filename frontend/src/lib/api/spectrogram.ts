import { postJSON } from "./http";
import type { DataStruct } from "../types";

/** Short-time Fourier transform of one channel as a long-form map table. */
export function runSpectrogram(
  request: { dataset: DataStruct } & Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DataStruct> {
  return postJSON("/api/spectral/spectrogram", request, signal);
}
