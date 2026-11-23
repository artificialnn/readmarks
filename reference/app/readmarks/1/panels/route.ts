// Registering a review panel. People use the form (GET); scripts POST JSON:
//   {"doc":"readmarks-1.0","registrant":"Name or organisation","sessions":[{"platform":"openai/chatgpt","n":5}, ...]}
import { secretOk, allow } from '@/lib/guard';
import { addressKey } from '@/lib/readmarks/core';
import { clientAddress } from '@/lib/readmarks/origins';
import { RM_DOCUMENTS } from '@/lib/readmarks/spec.generated';
import { registerPanel, reviewPlatforms } from '@/lib/readmarks/mark';
import { STANDARD_PROMPT } from '@/lib/readmarks/sessions';
import { esc, page } from '@/lib/readmarks/html';
import { errorPage, panelPromptPage } from '@/lib/readmarks/pages';
import { clean, json, readBody, wantsHtml } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return page('Register a Readmarks review panel', `<h1>Register a review panel</h1>
<p>A panel is a set of review sessions registered <strong>before</strong> any of them runs. Each session is one single-use link for one assistant. Every registered session is counted, including the ones nobody completes, so a panel cannot be trimmed to its good results.</p>
<form method="post" action="/readmarks/1/panels">
<p><label>Document<br><select name="doc">${RM_DOCUMENTS.map((d) => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join('')}</select></label></p>
<p><label>Who is registering (name or organisation; shown publicly)<br><input type="text" name="registrant" required maxlength="100" style="width:100%;font:inherit;padding:.5rem"></label></p>
${reviewPlatforms().map((p) => `<p><label>Sessions on ${esc(p.operator)} (${esc(p.id)})<br><input type="number" name="n:${esc(p.id)}" min="0" max="20" value="0" style="font:inherit;padding:.4rem;width:6rem"></label></p>`).join('')}
<button type="submit">Register</button></form>
<p class="fine">The standard prompt every session uses: ${esc(STANDARD_PROMPT.replace('{url}', '<session URL>'))}</p>`);
}

export async function POST(req: Request) {
  const html = wantsHtml(req);
  const fail = (status: number, reason: string) => (html ? errorPage(status, 'Panel not registered', reason) : json(status, { error: reason }));
  if (!allow(`readmarks-panel:${addressKey(clientAddress(req) || 'unknown')}`, 5, 86_400_000)) return fail(429, 'This address has registered several panels today. Try again tomorrow.');
  const raw = await readBody(req, 8192);
  if (!raw) return fail(413, 'Request too large.');
  let doc = '', registrant: string | null | undefined, plan: { platform: string; n: number }[] = [];
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  if (ct.startsWith('application/json')) {
    let b: { doc?: unknown; registrant?: unknown; sessions?: unknown };
    try { b = JSON.parse(raw.toString('utf8')); } catch { return fail(400, 'Invalid JSON.'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(400, 'The body must be a JSON object.');
    doc = typeof b.doc === 'string' ? b.doc : '';
    registrant = clean(b.registrant, 100);
    plan = Array.isArray(b.sessions) ? b.sessions.filter((x) => x && typeof x.platform === 'string').map((x) => ({ platform: x.platform, n: Number(x.n) })) : [];
  } else {
    const f = new URLSearchParams(raw.toString('utf8'));
    doc = f.get('doc') ?? '';
    registrant = clean(f.get('registrant') ?? undefined, 100);
    plan = [...f.entries()].filter(([k]) => k.startsWith('n:')).map(([k, v]) => ({ platform: k.slice(2), n: Number(v) }));
  }
  if (!registrant) return fail(400, 'Say who is registering the panel (1 to 100 characters).');
  const r = await registerPanel(req, doc, registrant, plan, secretOk(req.headers.get('x-readmarks-publisher-key'), process.env.READMARKS_PUBLISHER_KEY));
  if (!r.ok) return fail(r.status, r.reason);
  if (html) return panelPromptPage(r.panel, r.sessions);
  return json(201, { panel: r.panel, logIndex: r.receipt.index, sessions: r.sessions.map((s) => ({ platform: s.platform, url: `https://www.sgai.sg/readmarks/1/e/${s._id}`,
    prompt: STANDARD_PROMPT.replace('{url}', `https://www.sgai.sg/readmarks/1/e/${s._id}`), deadline: s.deadline })) });
}
