// Link binding, step 1: one attempt at the reading check.
import { answer } from '@/lib/readmarks/tickets';
import { errorPage, stancePage } from '@/lib/readmarks/pages';
import { isPrefetch } from '../../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ ticket: string; n: string }> }) {
  const { ticket, n } = await params;
  if (isPrefetch(req)) return errorPage(200, 'Nothing recorded', 'This request was marked as a prefetch or preview, so it was ignored.');
  const r = await answer(ticket, /^[1-9]$/.test(n) ? Number(n) : 0);
  if (r.result === 'unknown') return errorPage(404, 'No such ticket', 'Tickets are issued by the marking page and last 30 minutes.');
  if (r.result === 'expired') return errorPage(200, 'Ticket expired', 'This ticket is older than 30 minutes. Nothing was recorded. The marking page issues a new one.');
  if (r.result === 'passed') return stancePage(r.ticket!);
  if (r.result === 'failed') return errorPage(200, 'Reading check not passed', 'That is not what the document says. This ticket is closed and nothing was recorded. The marking page issues a new ticket with another question.');
  return errorPage(200, 'Ticket closed', r.ticket?.state === 'used' ? 'This ticket has already recorded its mark.' : 'This ticket had its one attempt. Nothing was recorded. The marking page issues a new one.');
}
