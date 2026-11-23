// The public state of one review panel: every registered session and what became of it.
import { panelSessions } from '@/lib/readmarks/sessions';
import { findPriv, receiptFor } from '@/lib/readmarks/log';
import { esc, page } from '@/lib/readmarks/html';
import { errorPage } from '@/lib/readmarks/pages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ panel: string }> }) {
  const { panel } = await params;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(panel)) return errorPage(404, 'No such panel', '');
  const ss = await panelSessions(panel);
  if (!ss.length) return errorPage(404, 'No such panel', 'Panels are listed in the log as entries of type "panel".');
  const reg = await findPriv({ panel });
  const rows = await Promise.all(ss.map(async (s, i) => {
    const r = s.leaf !== undefined ? await receiptFor(s.leaf) : null;
    const late = !r && Date.now() > new Date(s.deadline).getTime();
    return `<tr><td>${i + 1}</td><td>${esc(s.platform)}</td><td>${r ? `${esc(String(r.entry.stance))} (from ${esc(String(r.entry.platform ?? 'unknown origin'))})` : late ? 'no stance: counts as no endorsement' : s.state === 'opened' ? 'opened, no stance yet' : 'not opened yet'}</td><td>${r?.code ? `<a href="/readmarks/1/r/${esc(r.code)}">${esc(r.code)}</a>` : ''}</td><td class="mono">${esc(s.commitment.slice(0, 16))}…</td></tr>`;
  }));
  return page(`Readmarks review panel ${panel}`, `<h1>Review panel ${esc(panel)}</h1>
<p>Registered ${esc(reg ? reg.entry.time : '')} as log entry ${reg ? reg.index : '?'}, before any session ran. ${ss.length} sessions; deadline ${esc(new Date(ss[0].deadline).toISOString().slice(0, 10))}.</p>
<table><tr><th>#</th><th>Assigned to</th><th>Outcome</th><th>Receipt</th><th>Commitment</th></tr>${rows.join('')}</table>
<p class="fine">A session's commitment is SHA-256("readmarks-session|" + its secret token); the registration entry lists all of them, so no session can be added or dropped afterwards.</p>`);
}
