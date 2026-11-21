// `target.push(...items)` without the engine's argument cap (see arrayExtent.ts).

/** `target.push(...items)` without the argument cap; returns the new length. */
export function pushAll<T>(target: T[], items: ArrayLike<T>): number {
  for (let i = 0; i < items.length; i++) target.push(items[i]);
  return target.length;
}
