export declare function decodeSegment(seg: string): number[];
export declare function attributeMappings(
  input: { mappings: string; sources: readonly string[]; lines: readonly string[] },
  into?: Map<string, number>,
): Map<string, number>;
