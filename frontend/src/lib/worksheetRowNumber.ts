/** The number the worksheet gutter shows for the source row at 0-based index
 *  `row`. Every row number a user reads (result tables, saved "source row"
 *  columns, status lines) goes through this; indices stay 0-based internally. */
export const worksheetRowNumber = (row: number): number => row + 1;
