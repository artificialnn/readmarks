// The exact bytes of an operator address list as we fetched it, by SHA-256, so an auditor can check what a mark relied on.
import { blob } from '@/lib/readmarks/origins';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ sha: string }> }) {
  const b = await blob((await params).sha);
  if (!b) return new Response('not found', { status: 404 });
  return new Response(b.body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable',
    'x-source-url': b.url, 'x-fetched-at': new Date(b.fetchedAt).toISOString() } });
}
