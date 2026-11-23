// The signed checkpoint (c2sp.org/tlog-checkpoint): origin, tree size, root hash, signature.
import { checkpoint } from '@/lib/readmarks/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cp = await checkpoint();
  return new Response(cp.note, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
}
