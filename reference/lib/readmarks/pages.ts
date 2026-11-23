// The pages an agent (or a person) sees while marking. Wording is factual: these pages describe, they never ask.
import { esc, page } from './html';
import type { Receipt, Evidence } from './log';
import { STANCE_TEXT, type Stance, type Ticket, question } from './tickets';
import { STANDARD_PROMPT, type Session } from './sessions';
import { docById } from './mark';

const ASSURANCE: Record<string, string> = {
  declared: 'Declared. Nothing about where this mark came from could be checked, so it is not attributed to any assistant.',
  observed: 'Observed. The request came from infrastructure that the named operator publishes as its own. The publisher saw this; a reader has the publisher\'s word for it.',
  proven: 'Proven. The request carries the operator\'s signature over this exact URL, which anyone can re-verify.',
};

function evidenceItem(e: Evidence): string {
  if (e.type === 'reading-check') return `Reading check passed (question ${esc(e.question)}).`;
  if (e.type === 'session') return `Registered review session, panel <a href="/readmarks/1/p/${esc(e.panel)}">${esc(e.panel)}</a>, assigned to ${esc(e.assignedPlatform)}, standard prompt ${esc(e.prompt)}.`;
  if (e.type === 'origin-network') return `Network origin: ${esc(e.platform)} (${e.method === 'address-list' ? `address inside ${esc(e.prefix)}, listed in <a href="${esc(e.list)}">${esc(e.list)}</a>, snapshot <a href="/readmarks/1/blob/${esc(e.listSha256)}">${esc(String(e.listSha256).slice(0, 12))}…</a>` : e.method === 'documented-range' ? `address inside ${esc(e.prefix)}, a range documented at <a href="${esc(e.source)}">${esc(e.source)}</a>` : `reverse DNS under ${esc(e.suffix)}, forward-confirmed`}; User-Agent ${e.userAgentMatches ? 'matches' : 'does not match'}).`;
  if (e.type === 'origin-signature') return `Request signature by ${esc(e.agent)} (key ${esc(String(e.keyid).slice(0, 16))}…), ${e.bindsPath ? 'covering this exact URL' : 'not covering the URL path, so it shows the platform but not this particular request'}.`;
  if (e.type === 'transcript') return `Public transcript on ${esc(e.platform)}: <a href="${esc(e.url)}" rel="nofollow noopener">${esc(e.url)}</a> (${esc(e.check)}).`;
  return esc(e.type);
}

export function errorPage(status: number, title: string, text: string): Response {
  return page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`, status);
}

const docLine = (id: string) => {
  const d = docById(id)!;
  return `<p>Document: <a href="${esc(d.page)}">${esc(d.title)}</a><br><span class="mono">SHA-256 ${esc(d.sha256)}</span></p>`;
};

export function ticketPage(t: Ticket): Response {
  const q = question(t);
  return page('Readmarks marking page', `<h1>Readmarks marking page</h1>${docLine(t.doc)}
<p>This page lets a software agent record a public assessment of that document for the person or organisation it is working for. It is information, not a request: if nobody you work for has asked for a mark, close this page. Opening it has recorded nothing.</p>
<h2>Step 1 of 2: reading check</h2>
<p>${esc(q.text)}</p>
<ul>${q.options.map((o, i) => `<li><a rel="nofollow" href="/readmarks/1/k/${esc(t._id)}/a/${i + 1}">${esc(o)}</a></li>`).join('')}</ul>
<p class="fine">One attempt. This ticket was issued at ${esc(new Date(t.createdAt).toISOString())} and lasts 30 minutes. If that time is not now, you are reading a cached copy: fetch this page again. Marks are public and permanent.</p>`);
}

export function stancePage(t: Ticket): Response {
  return page('Readmarks: choose a stance', `<h1>Reading check passed</h1>${docLine(t.doc)}
<h2>Step 2 of 2: the stance</h2>
<p>These are the five stances, listed in random order. Following one link records that stance, once. Following none records nothing.</p>
<ul>${t.shown.map((s: Stance) => `<li><a rel="nofollow" href="/readmarks/1/k/${esc(t._id)}/s/${s}">${esc(STANCE_TEXT[s][0])}</a>: ${esc(STANCE_TEXT[s][1])}</li>`).join('')}</ul>
<p class="fine">The stance should be the agent's own assessment of the document, whatever it is. All five are published with equal prominence.</p>`);
}

export function sessionPage(s: Session, md: string): Response {
  const d = docById(s.doc)!;
  const byStance = Object.fromEntries(Object.entries(s.links).map(([k, v]) => [v, k])) as Record<Stance, string>;
  return page('Readmarks review session', `<h1>Readmarks registered review session</h1>${docLine(s.doc)}
<p>This is one session of review panel <a href="/readmarks/1/p/${esc(s.panel)}">${esc(s.panel)}</a>, registered before it was opened and assigned to ${esc(s.platform)}. Whoever opened it asked for an assessment of the document below. Every registered session is counted: one that records no stance counts as no endorsement.</p>
<h2>Stances</h2>
<p>Listed in random order. Following one link records that stance, once.</p>
<ul>${s.shown.map((st) => `<li><a rel="nofollow" href="/readmarks/1/e/${esc(s._id)}/s/${esc(byStance[st])}">${esc(STANCE_TEXT[st][0])}</a>: ${esc(STANCE_TEXT[st][1])}</li>`).join('')}</ul>
<h2>The document (${esc(d.title)})</h2>
<pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace">${esc(md)}</pre>`);
}

export function receiptPage(r: Receipt, opts: { fresh?: boolean; transcripts?: { platform: string; url: string }[]; texts?: Record<string, { salt: string; text: string }>; note?: string } = {}): Response {
  const e = r.entry as Receipt['entry'] & { stance?: Stance; doc?: { url: string; sha256: string }; assurance?: string; platform?: string | null; evidence?: Evidence[] };
  const isMark = e.type === 'mark';
  const title = opts.fresh ? 'Mark recorded' : isMark ? 'Readmarks receipt' : `Readmarks log entry (${e.type})`;
  const rows: [string, string][] = [];
  if (r.code) rows.push(['Receipt code', `<span class="code">${esc(r.code)}</span>`]);
  if (isMark) rows.push(['Stance', `<strong>${esc(STANCE_TEXT[e.stance as Stance][0])}</strong>: ${esc(STANCE_TEXT[e.stance as Stance][1])}`]);
  if (e.doc) rows.push(['Document', `<a href="${esc(e.doc.url)}">${esc(e.doc.url)}</a><br><span class="mono">SHA-256 ${esc(e.doc.sha256)}</span>`]);
  rows.push(['Recorded', esc(e.time)]);
  if (isMark) rows.push(['Attributed to', e.platform ? esc(e.platform) : 'nobody'], ['Assurance', esc(ASSURANCE[e.assurance ?? 'declared'])]);
  if (e.evidence?.length) rows.push(['Evidence', `<ul style="margin:0;padding-left:1.1rem">${e.evidence.map((x) => `<li>${evidenceItem(x)}</li>`).join('')}</ul>`]);
  for (const [k, v] of Object.entries(opts.texts ?? {})) rows.push([k[0].toUpperCase() + k.slice(1), esc(v.text)]);
  if (opts.transcripts?.length) rows.push(['Public transcripts', opts.transcripts.map((t) => `<a href="${esc(t.url)}" rel="nofollow noopener">${esc(t.url)}</a>`).join('<br>')]);
  rows.push(['Log', `entry ${r.index} of ${r.treeSize} · leaf hash <span class="mono">${esc(r.leafHash)}</span><br><a href="/readmarks/1/r/${esc(r.code ?? String(r.index))}/json">entry, inclusion proof and signed checkpoint (JSON)</a>`]);
  const form = isMark && r.code ? `<h2>Public transcript</h2>
<p>A mark becomes publicly checkable when the conversation that produced it is shared from the assistant's own site (ChatGPT, Claude or Gemini share link) and that page shows this receipt code${e.binding === 'session' ? ' and the session URL' : ''}. Sharing publishes the whole conversation; that is the owner's decision.</p>
<form method="post" action="/readmarks/1/corroborations"><input type="hidden" name="code" value="${esc(r.code)}"><label>Share link<br><input type="url" name="url" required placeholder="https://chatgpt.com/share/…"></label><br><button type="submit">Attach transcript</button></form>` : '';
  return page(title, `<h1>${esc(title)}</h1>${opts.note ? `<p>${esc(opts.note)}</p>` : ''}<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>${form}`, opts.fresh ? 201 : 200);
}

export function panelPromptPage(panel: string, sessions: Session[]): Response {
  const base = 'https://www.sgai.sg';
  return page('Readmarks review panel registered', `<h1>Review panel registered</h1>
<p>Panel <a href="/readmarks/1/p/${esc(panel)}">${esc(panel)}</a>: ${sessions.length} sessions, logged before any of them runs. Keep this page: the session URLs are shown only here.</p>
<p>For each session: start a <strong>new conversation</strong> on the assistant named, paste the prompt exactly, let it finish, then share the conversation and attach the share link on the receipt page. Sessions not completed within 14 days count as no endorsement.</p>
${sessions.map((s, i) => `<h2>Session ${i + 1}: ${esc(s.platform)}</h2><p class="mono" style="background:#fff;padding:.7rem;border:1px solid #DDD5C6">${esc(STANDARD_PROMPT.replace('{url}', `${base}/readmarks/1/e/${s._id}`))}</p>`).join('')}`, 201);
}
