import { timingSafeEqual } from 'node:crypto';

// The three helpers the Readmarks routes use (the site's own file has more).
export function clientIp(req: Request): string {
  const ip = (req.headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || 'unknown';
  // An IPv6 user usually controls a whole /64: rate limits treat it as one address.
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const g = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${g.slice(0, 4).join(':')}::/64`;
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
