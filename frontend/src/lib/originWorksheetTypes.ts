/** `origin_fidelity.worksheet` (io/origin_project/worksheet_fidelity.py):
 *  what an Origin `.opju` import's worksheet decode did not bring in. Its own
 *  module so lib/types.ts stays within its line pin. */

export interface OriginWorksheetLoss {
  code: string;
  count: number;
  examples: string[];
}

export interface OriginWorksheetFidelity {
  version: 1;
  status: "complete" | "unverified" | "partial";
  columns_imported: number;
  unverified_columns: number;
  losses: OriginWorksheetLoss[];
}
