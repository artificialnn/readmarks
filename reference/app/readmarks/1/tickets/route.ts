// HTTP binding, step 1: POST {"doc": "<document URL or id>"} -> a ticket with its reading-check question.
import { after } from 'next/server';
import { docById, docByUrl } from '@/lib/readmarks/mark';
import { observe, refreshStaleLists } from '@/lib/readmarks/origins';
import { TICKET_TTL_MS, mint, question, ticketsSince } from '@/lib/readmarks/tickets';
import { CORS, ipH, json, readBody } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, signature, signature-input, signature-agent, content-digest' } }); }

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { error: 'content-type must be application/json' });
  const raw = await readBody(req);
  if (!raw) return json(413, { error: 'body too large' });
  let b: { doc?: unknown };
  try { b = JSON.parse(raw.toString('utf8')); } catch { return json(400, { error: 'invalid JSON' }); }
  const doc = typeof b?.doc === 'string' ? docById(b.doc) ?? docByUrl(b.doc) : null;
  if (!doc) return json(400, { error: 'doc must be a document listed in /.well-known/readmarks.json' });
  const obs = await observe(req, raw);
  if (obs.needsRefresh) after(() => refreshStaleLists());
  if (obs.sigError) return json(401, { error: `signature: ${obs.sigError}` });
  if (!obs.eligible) return json(403, { error: 'crawlers and indexers do not receive tickets' });
  const who = ipH(req);
  if ((await ticketsSince(who, new Date(Date.now() - 3600_000))) >= (obs.platform ? 600 : 30)) return json(429, { error: 'too many tickets from this address in the last hour' }, { 'retry-after': '3600' });
  const t = await mint(doc.id, obs.platform, who, 'http');
  if (!t) return json(503, { error: 'this document has no reading check yet' });
  const q = question(t);
  return json(201, { ticket: t._id, expires: new Date(new Date(t.createdAt).getTime() + TICKET_TTL_MS).toISOString(), document: { url: doc.url, sha256: doc.sha256 },
    question: { text: q.text, options: q.options, answerWith: 'the 1-based position of one option; one attempt' }, stances: t.shown });
}
