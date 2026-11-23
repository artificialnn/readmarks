// The log as JSON, for people and agents that do not parse tiles: GET ?from=<index>&limit=<1..500>
import { entries, size, texts } from '@/lib/readmarks/log';
import { json } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const from = Math.max(0, Math.floor(Number(u.searchParams.get('from') ?? 0)) || 0);
  const limit = Math.max(1, Math.min(500, Math.floor(Number(u.searchParams.get('limit') ?? 100)) || 100));
  const es = await entries(from, limit);
  const tx = await texts(es.map((e) => e.index));
  return json(200, { size: await size(), entries: es.map((e) => ({ ...e, ...(tx.has(e.index) ? { text: tx.get(e.index) } : {}) })) });
}
