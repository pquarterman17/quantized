export declare function verifyPreloadLists(
  chunks: Record<string, { code: string; css: readonly string[]; isEntry: boolean }>,
): Promise<{ sites: number; checked: number; violations: string[] }>;
