interface ChunkLike {
  type: "chunk" | "asset";
  isEntry?: boolean;
  imports?: readonly string[];
}
type BundleLike = Record<string, ChunkLike>;

export declare function staticClosure(bundle: BundleLike, host: string): Set<string>;
export declare function alwaysLoaded(bundle: BundleLike): Set<string>;
export declare function pruneLoadedDeps(
  deps: readonly string[],
  host: string,
  closureOf: (host: string) => Set<string>,
  always?: Set<string>,
): string[];
export declare function preloadPrune(): {
  plugin: {
    name: string;
    apply: "build";
    generateBundle: { order: "pre"; handler: (opts: unknown, output: BundleLike) => void };
  };
  resolveDependencies: (
    filename: string,
    deps: string[],
    context: { hostId: string; hostType: "html" | "js" },
  ) => string[];
};
