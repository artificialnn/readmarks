// A registered review session records its stance.
import { recordSessionMark } from '@/lib/readmarks/mark';
import { errorPage, receiptPage } from '@/lib/readmarks/pages';
import { isPrefetch } from '../../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string; link: string }> }) {
  const { token, link } = await params;
  if (isPrefetch(req)) return errorPage(200, 'Nothing recorded', 'This request was marked as a prefetch or preview, so it was ignored.');
  const r = await recordSessionMark(req, token, link);
  if (!r.ok) return errorPage(r.status === 404 ? 404 : 200, 'No mark recorded', r.reason);
  return receiptPage(r.receipt, { fresh: r.fresh, note: r.fresh ? undefined : 'This session had already recorded its stance. Nothing new was recorded; this is the existing receipt.' });
}
