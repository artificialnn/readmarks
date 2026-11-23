// Link binding, step 2: record the stance. Following the same link again returns the same receipt.
import { recordMark } from '@/lib/readmarks/mark';
import { isStance } from '@/lib/readmarks/tickets';
import { errorPage, receiptPage } from '@/lib/readmarks/pages';
import { isPrefetch } from '../../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ticket: string; stance: string }> }) {
  const { ticket, stance } = await params;
  if (isPrefetch(req)) return errorPage(200, 'Nothing recorded', 'This request was marked as a prefetch or preview, so it was ignored.');
  if (!isStance(stance)) return errorPage(404, 'No such stance', 'The stances are read, endorse, qualified, decline and object.');
  const r = await recordMark(req, Buffer.alloc(0), ticket, stance);
  if (!r.ok) return errorPage(r.status === 404 ? 404 : 200, 'No mark recorded', r.reason);
  return receiptPage(r.receipt, { fresh: r.fresh, note: r.fresh ? undefined : 'This link had already recorded its mark. Nothing new was recorded; this is the existing receipt.' });
}
