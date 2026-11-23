// The exact bytes of an article that accepts Readmarks (its source text). Their SHA-256 is the document version.
import { RM_DOCUMENTS } from '@/lib/readmarks/spec.generated';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return RM_DOCUMENTS.filter((d) => d.kind === 'article' || d.kind === 'report').map((d) => ({ file: `${d.id}.md` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const id = decodeURIComponent(file).replace(/\.md$/, '');
  const d = RM_DOCUMENTS.find((x) => (x.kind === 'article' || x.kind === 'report') && x.id === id);
  if (!d) return new Response('not found', { status: 404 });
  return new Response(d.md, { headers: {
    'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*',
    link: `</.well-known/readmarks.json>; rel="readmarks", <${d.page}>; rel="canonical"`, 'x-content-sha256': d.sha256,
  } });
}
