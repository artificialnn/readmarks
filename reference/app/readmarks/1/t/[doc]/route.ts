// Link binding, step 0: the marking page for one document. Mints a single-use ticket with one reading-check question.
import { after } from 'next/server';
import { docById } from '@/lib/readmarks/mark';
import { observe, refreshStaleLists } from '@/lib/readmarks/origins';
import { mint, ticketsSince } from '@/lib/readmarks/tickets';
import { errorPage, ticketPage } from '@/lib/readmarks/pages';
import { ipH } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!docById(doc)) return errorPage(404, 'No such document', 'This publisher lists its documents at /.well-known/readmarks.json.');
  const obs = await observe(req);
  if (obs.needsRefresh) after(() => refreshStaleLists());
  if (!obs.eligible) return errorPage(403, 'No ticket', 'Crawlers and indexers do not receive tickets: they fetch pages without anyone asking for a mark.');
  const who = ipH(req);
  // Assistants share a few egress addresses among many users, so recognised platforms get a much higher allowance.
  if ((await ticketsSince(who, new Date(Date.now() - 3600_000))) >= (obs.platform ? 600 : 30)) return errorPage(429, 'Too many tickets', 'This address has asked for many tickets in the last hour. Try again later.');
  const t = await mint(doc, obs.platform, who, 'link');
  if (!t) return errorPage(503, 'Not available', 'This document has no reading check yet.');
  return ticketPage(t);
}
