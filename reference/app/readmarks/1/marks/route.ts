// HTTP binding, step 2: POST {"ticket","answer","stance","agent"?,"operator"?,"statement"?} -> a receipt.
import { recordMark } from '@/lib/readmarks/mark';
import { answer, getTicket, isStance } from '@/lib/readmarks/tickets';
import { CORS, clean, json, readBody } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() { return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, signature, signature-input, signature-agent, content-digest' } }); }

export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { error: 'content-type must be application/json' });
  const raw = await readBody(req);
  if (!raw) return json(413, { error: 'body too large (4096 bytes at most)' });
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw.toString('utf8')); } catch { return json(400, { error: 'invalid JSON' }); }
  if (!b || typeof b !== 'object' || Array.isArray(b) || !Object.keys(b).every((k) => ['ticket', 'answer', 'stance', 'agent', 'operator', 'statement'].includes(k))) return json(400, { error: 'unknown fields' });
  if (typeof b.ticket !== 'string' || !isStance(b.stance)) return json(400, { error: 'ticket and stance (read, endorse, qualified, decline, object) are required' });
  const agent = clean(b.agent, 100), operator = clean(b.operator, 100), statement = clean(b.statement, 500);
  if (agent === null || operator === null || statement === null) return json(400, { error: 'agent and operator: 1-100 characters; statement: 1-500 characters' });
  const t = await getTicket(b.ticket);
  if (!t) return json(404, { error: 'no such ticket' });
  if (t.state === 'open') {
    const r = await answer(b.ticket, Number.isInteger(b.answer) ? (b.answer as number) : 0);
    if (r.result !== 'passed') return json(r.result === 'expired' ? 410 : 409, { error: r.result === 'failed' ? 'reading check not passed; this ticket is closed' : `ticket ${r.result}` });
  }
  const m = await recordMark(req, raw, b.ticket, b.stance, { agent, operator, statement });
  if (!m.ok) return json(m.status, { error: m.reason });
  return json(m.fresh ? 201 : 200, m.receipt, m.receipt.code ? { location: `/readmarks/1/r/${m.receipt.code}` } : {});
}
