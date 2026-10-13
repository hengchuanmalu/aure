// History state only carries a small token. Never clone a 100k-ID sequence per keypress.
const sequences = new Map<string, readonly string[]>();
export function rememberSequence(ids: readonly string[]) {
  const key = crypto.randomUUID();
  sequences.set(key, [...ids]);
  while (sequences.size > 3) sequences.delete(sequences.keys().next().value!);
  return key;
}
export function recalledSequence(key?: string) {
  return key ? sequences.get(key) : undefined;
}
