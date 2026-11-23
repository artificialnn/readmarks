// A registered review session: the document plus five stance links with opaque names.
import { after } from 'next/server';
import { docById, fromAssigned } from '@/lib/readmarks/mark';
import { observe, refreshStaleLists } from '@/lib/readmarks/origins';
import { getSession, openSession } from '@/lib/readmarks/sessions';
import { receiptFor } from '@/lib/readmarks/log';
import { errorPage, receiptPage, sessionPage } from '@/lib/readmarks/pages';
import { isPrefetch } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (isPrefetch(req)) return errorPage(200, 'Nothing recorded', 'This request was marked as a prefetch or preview, so it was ignored.');
  const s0 = await getSession(token);
  if (!s0) return errorPage(404, 'No such session', 'Review sessions are registered in panels; see the specification.');
  const obs = await observe(req);
  if (obs.needsRefresh) after(() => refreshStaleLists());
  if (!obs.eligible) return errorPage(403, 'Not for crawlers', 'Crawlers and indexers do not open review sessions.');
  if (s0.state === 'marked' && s0.leaf !== undefined) return receiptPage(await receiptFor(s0.leaf), { note: 'This session has already recorded its stance. Nothing new was recorded; this is the existing receipt.' });
  if (Date.now() > new Date(s0.deadline).getTime()) return errorPage(200, 'Session past its deadline', 'This session was not completed in time. It counts as no endorsement.');
  const s = await openSession(token, obs.platform, !fromAssigned(obs.platform, s0.platform));
  return sessionPage(s!, docById(s!.doc)!.md);
}
