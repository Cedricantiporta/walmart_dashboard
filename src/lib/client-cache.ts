// Module-level singleton: survives Next.js route changes within the same browser session.
// Resets only on full page reload.

const _store = new Map<string, { data: unknown; ts: number }>();
const DEFAULT_TTL = 90 * 1000; // 90 sec — keeps UI snappy on tab switches while staying fresh after syncs

export function clientGet<T>(key: string): T | null {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DEFAULT_TTL) { _store.delete(key); return null; }
  return entry.data as T;
}

export function clientSet(key: string, data: unknown): void {
  _store.set(key, { data, ts: Date.now() });
}

export function clientClear(key: string): void {
  _store.delete(key);
}
