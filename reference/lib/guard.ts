import { timingSafeEqual } from 'node:crypto';

// The three helpers the Readmarks routes use (the site's own file has more).
export function clientIp(req: Request): string {
  return (req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || 'unknown';
}

const buckets = new Map<string, number[]>();
/** Sliding-window limit: true if this hit is allowed. */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { buckets.set(key, hits); return false; }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) { if (!v.length || now - v[v.length - 1] > 3600_000) buckets.delete(k); }
  return true;
}

/** Constant-time check of an admin header against an env secret. */
export function secretOk(given: string | null, secret: string | undefined): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
