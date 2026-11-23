// Tiles (c2sp.org/tlog-tiles): /tile/<L>/<N>[.p/<W>] are 32-byte hashes; /tile/entries/<N>[.p/<W>] are the entries.
import { entryBundle, hashTile, parseTilePath } from '@/lib/readmarks/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = parseTilePath((await params).path);
  if (!t) return new Response('bad tile path', { status: 400 });
  const body = t.kind === 'entries' ? await entryBundle(t.n, t.width) : await hashTile(t.level, t.n, t.width);
  if (!body) return new Response('not found', { status: 404 });
  // A full tile never changes; a partial one is replaced by a wider one as the log grows.
  return new Response(new Uint8Array(body), { headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*',
    'cache-control': t.width === 256 ? 'public, max-age=31536000, immutable' : 'no-store' } });
}
