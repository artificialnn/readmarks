// Attach a public transcript (a share link on the assistant's own site) to a mark.
import { allow } from '@/lib/guard';
import { addressKey } from '@/lib/readmarks/core';
import { clientAddress } from '@/lib/readmarks/origins';
import { corroborate } from '@/lib/readmarks/mark';
import { errorPage, receiptPage } from '@/lib/readmarks/pages';
import { fullReceipt, json, readBody, wantsHtml } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const html = wantsHtml(req);
  const fail = (status: number, reason: string) => (html ? errorPage(status === 404 ? 404 : 200, 'Transcript not attached', reason) : json(status, { error: reason }));
  if (!allow(`readmarks-corr:${addressKey(clientAddress(req) || 'unknown')}`, 20, 3600_000)) return fail(429, 'Too many attempts from this address. Try again later.');
  const raw = await readBody(req);
  if (!raw) return fail(413, 'Request too large.');
  let code = '', url = '';
  if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    try { const b = JSON.parse(raw.toString('utf8')); code = String(b.code ?? ''); url = String(b.url ?? ''); } catch { return fail(400, 'Invalid JSON.'); }
  } else {
    const f = new URLSearchParams(raw.toString('utf8'));
    code = f.get('code') ?? ''; url = f.get('url') ?? '';
  }
  if (url.length > 300 || code.length > 40) return fail(400, 'Bad input.');
  const r = await corroborate(code, url);
  if (!r.ok) return fail(r.status, r.reason);
  if (!html) return json(r.already ? 200 : 201, r.receipt);
  const full = await fullReceipt(code);
  return receiptPage(full!.receipt, { transcripts: full!.transcripts, texts: full!.texts, note: r.already ? 'That transcript was already attached.' : 'Transcript attached: the shared page shows this receipt code. Anyone can open the link and check.' });
}
