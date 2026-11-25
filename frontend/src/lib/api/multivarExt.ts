// /api/stats/{pls,lda,pca-spectra} wrappers (GAP_AUDIT_9 G12). NOT re-exported
// by lib/api.ts: the only consumer is the lazy PLS / LDA / spectra tab of the
// Multivariate workshop, which imports this path directly (eager bundle unchanged).

import { postJSON } from "./http";

export type PlsPreprocess = "none" | "center" | "autoscale";

export interface PlsBody {
  x: number[][]; y: number[][]; n_components?: number; max_components?: number;
  folds?: number; seed?: number; preprocess?: PlsPreprocess;
}
export interface PlsCv {
  folds: number; seed: number; max_components: number; best: number;
  /** components x responses */
  press: number[][]; rmsecv: number[][]; q2: number[][]; q2_mean: number[];
}
export interface PlsResult {
  n: number; p: number; m: number; n_components: number; auto_components: boolean;
  preprocess: PlsPreprocess; components_max: number; cv: PlsCv;
  scores: number[][]; x_weights: number[][]; x_loadings: number[][]; y_loadings: number[][];
  /** variables x responses, original units */
  coef: number[][]; intercept: number[]; vip: (number | null)[];
  r2y: (number | null)[]; r2y_mean: number; r2y_cumulative: (number | null)[][]; r2x: number[];
  q2: (number | null)[]; q2_mean: number; rmsec: number[]; rmsecv: number[];
  measured: number[][]; predicted: number[][]; cv_predicted: number[][]; residuals: number[][];
}

export interface LdaBody { x: number[][]; labels: (string | number)[]; priors?: "empirical" | "equal"; cv_folds?: number; seed?: number }
export interface LdaResult {
  n: number; p: number; classes: string[]; n_discriminants: number; priors: number[]; priors_mode: string;
  explained_variance_ratio: number[]; scores: number[][]; decision: number[][]; posterior: number[][];
  actual: number[]; predicted: number[]; confusion: number[][]; accuracy: number; means: number[][];
  class_means_scores: number[][];
  cv: { folds: number; seed: number; predicted: number[]; confusion: number[][]; accuracy: number } | null;
}

export interface SpectraPcaBody {
  spectra_x: number[][]; spectra_y: number[][]; center?: boolean; scale?: boolean;
  num_components?: number; resample?: boolean;
}
export interface SpectraPcaResult {
  grid: number[]; n_spectra: number; notes: string[]; score: number[][]; coeff: number[][];
  explained: number[]; cumulative: number[]; latent: number[];
}

export const statsPls = (body: PlsBody): Promise<PlsResult> => postJSON("/api/stats/pls", body);
export const statsLda = (body: LdaBody): Promise<LdaResult> => postJSON("/api/stats/lda", body);
export const statsPcaSpectra = (body: SpectraPcaBody): Promise<SpectraPcaResult> => postJSON("/api/stats/pca-spectra", body);
