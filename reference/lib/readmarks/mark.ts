// Recording a mark (all bindings), attaching a public transcript to a mark, and the counting rule.
import { RM_DOCUMENTS, RM_QUESTIONS_SHA256 } from './spec.generated';
import { ipHash } from './core';
import { append, commit, countSince, entries, findByCode, findPriv, receiptFor, size, texts, type Entry, type Evidence, type Receipt } from './log';
import { clientAddress, observe, originById, registry, transcriptPlatform, type Observation } from './origins';
import { claim, release, setLeaf, ticketHash, type Stance } from './tickets';
import { PROMPT_ID, SESSION_DAYS, STANDARD_PROMPT, getSession, claimSession, createSessions, newPanelId, panelSessions, releaseSession, sessionCommitment, setSessionLeaf, type Session } from './sessions';

export const docById = (id: string) => RM_DOCUMENTS.find((d) => d.id === id) ?? null;
export const docByUrl = (url: string) => RM_DOCUMENTS.find((d) => d.url === url || d.page === url) ?? null;

const ALL: Stance[] = ['read', 'endorse', 'qualified', 'decline', 'object'];
export const DECLARED_PER_HOUR = 200;
export const PANELS_PER_DAY_PER_ADDRESS = 5;
export const PANELS_PER_DAY = 300; // backstop against log bloat only; the per-address cap is the working limit

export type MarkResult =
  | { ok: true; receipt: Receipt; fresh: boolean; observation: Observation | null }
  | { ok: false; status: number; reason: string };

export async function recordMark(req: Request, body: Buffer, ticketId: string, stance: Stance,
  extra: { agent?: string; operator?: string; statement?: string } = {}): Promise<MarkResult> {
  const th = ticketHash(ticketId);
  const prior = async (): Promise<MarkResult | null> => {
    const e = await findPriv({ ticket: th });
    if (!e) return null;
    if (e.entry.stance !== stance) return { ok: false, status: 409, reason: `this ticket already recorded the stance "${e.entry.stance}"; a ticket records one mark` };
    return { ok: true, receipt: await receiptFor(e.index), fresh: false, observation: null };
  };
  const again = await prior();
  if (again) return again; // following the same link twice returns the same receipt and records nothing new

  const c = await claim(ticketId, stance);
  if (!c.ok) {
    if (c.reason === 'used') return (await prior()) ?? { ok: false, status: 409, reason: 'ticket already used' };
    if (c.reason === 'unknown') return { ok: false, status: 404, reason: 'no such ticket' };
    if (c.reason === 'expired') return { ok: false, status: 410, reason: 'ticket expired (tickets last 30 minutes)' };
    return { ok: false, status: 409, reason: 'the reading check for this ticket has not been passed' };
  }
  const t = c.ticket;
  try {
    const obs = await observe(req, body);
    if (obs.sigError) { await release(ticketId); return { ok: false, status: 401, reason: `signature: ${obs.sigError}` }; }
    if (!obs.eligible) { await release(ticketId); return { ok: false, status: 403, reason: 'crawlers and indexers do not leave marks' }; }
    // Unattributed marks count for nothing, so the only thing a flood of them can do is bloat the log: cap them globally.
    if (obs.assurance === 'declared' && (await countSince({ assurance: 'declared' }, new Date(Date.now() - 3600_000))) >= DECLARED_PER_HOUR) {
      await release(ticketId);
      return { ok: false, status: 429, reason: 'too many unattributed marks in the last hour; try again later' };
    }
    const doc = docById(t.doc)!;
    const text: Record<string, { salt: string; text: string }> = {};
    const claims: Record<string, string> = {};
    for (const [k, v] of Object.entries(extra)) {
      if (!v) continue;
      const cm = commit(v);
      claims[k] = cm.commitment;
      text[k] = { salt: cm.salt, text: cm.text };
    }
    const evidence: Evidence[] = [
      { type: 'reading-check', bank: RM_QUESTIONS_SHA256[t.doc], question: t.q, result: 'pass', ticketPlatform: t.platform },
      ...obs.evidence,
    ];
    const receipt = await append({
      type: 'mark', doc: { url: doc.url, sha256: doc.sha256 }, stance, binding: t.binding, shown: t.shown, ticket: th,
      platform: obs.platform, assurance: obs.assurance, registry: registry().sha256, evidence,
      ...(Object.keys(claims).length ? { claims } : {}),
    }, { priv: { ip: ipHash(clientAddress(req) || 'unknown'), ticket: th, platform: obs.platform, assurance: obs.assurance, doc: t.doc, stance }, text, withCode: true });
    await setLeaf(ticketId, receipt.index);
    return { ok: true, receipt, fresh: true, observation: obs };
  } catch (e) {
    await release(ticketId);
    throw e;
  }
}

/** Appends a `document` entry for every listed document version the log has not recorded yet. Run once at launch and after each new text. */
export async function logDocuments(): Promise<{ id: string; index: number; fresh: boolean }[]> {
  const out: { id: string; index: number; fresh: boolean }[] = [];
  for (const d of RM_DOCUMENTS) {
    const seen = await findPriv({ document: `${d.url}|${d.sha256}` });
    if (seen) { out.push({ id: d.id, index: seen.index, fresh: false }); continue; }
    const r = await append({ type: 'document', doc: { url: d.url, sha256: d.sha256 }, version: d.version, title: d.title, page: d.page }, { priv: { document: `${d.url}|${d.sha256}` } });
    out.push({ id: d.id, index: r.index, fresh: true });
  }
  return out;
}

// ---- registered review sessions --------------------------------------------------------------------------------
export const reviewPlatforms = () => registry().transcripts.map((t) => ({ id: t.platform, operator: t.operator }));
const operatorOf = (platform: string | null) => (platform ? originById(platform)?.operator ?? registry().transcripts.find((t) => t.platform === platform)?.operator ?? null : null);
const programmable = (platform: string | null) => !!(platform && (originById(platform) as { programmable?: boolean } | null)?.programmable);
/** True when a request observed as `platform` came from the own, non-programmable infrastructure of the operator behind `assigned`. */
export const fromAssigned = (platform: string | null, assigned: string) => {
  if (!platform || programmable(platform) || !operatorOf(platform) || operatorOf(platform) !== operatorOf(assigned)) return false;
  const row = originById(platform);
  return !row || (row.eligible && row.kind !== 'crawler'); // transcript platforms have no origin row; crawlers never stand for an assistant
};

/** Registers a panel: N single-use sessions, each assigned to one assistant, logged BEFORE any of them can run. */
export async function registerPanel(req: Request, docId: string, registrant: string, plan: { platform: string; n: number }[], byPublisher: boolean):
  Promise<{ ok: true; panel: string; receipt: Receipt; sessions: Session[] } | { ok: false; status: number; reason: string }> {
  const doc = docById(docId);
  if (!doc) return { ok: false, status: 400, reason: 'unknown document' };
  const known = new Set(reviewPlatforms().map((p) => p.id));
  const clean = plan.filter((x) => known.has(x.platform) && Number.isInteger(x.n) && x.n > 0);
  const total = clean.reduce((a, b) => a + b.n, 0);
  const max = byPublisher ? 60 : 20;
  if (!clean.length || total > max) return { ok: false, status: 400, reason: `register 1 to ${max} sessions on assistants that have public share links (see /readmarks/1/origins)` };
  if (!byPublisher) {
    const day = new Date(Date.now() - 86_400_000);
    if ((await countSince({ kind: 'panel', ip: ipHash(clientAddress(req) || 'unknown') }, day)) >= PANELS_PER_DAY_PER_ADDRESS) return { ok: false, status: 429, reason: 'this address has registered its panels for today; try again tomorrow' };
    if ((await countSince({ kind: 'panel' }, day)) >= PANELS_PER_DAY) return { ok: false, status: 429, reason: 'the daily allowance for new panels is used up; try again tomorrow' };
  }
  const panel = newPanelId();
  const sessions = await createSessions(panel, docId, clean);
  const who = commit(registrant);
  const receipt = await append({ type: 'panel', panel, doc: { url: doc.url, sha256: doc.sha256 }, prompt: PROMPT_ID, registeredBy: byPublisher ? 'publisher' : 'other',
    deadlineDays: SESSION_DAYS, sessions: sessions.map((x) => ({ platform: x.platform, commitment: x.commitment, links: x.linksCommitment })), claims: { registrant: who.commitment } },
  { priv: { ip: ipHash(clientAddress(req) || 'unknown'), panel, kind: 'panel' }, text: { registrant: { salt: who.salt, text: who.text } } });
  return { ok: true, panel, receipt, sessions };
}

export async function recordSessionMark(req: Request, token: string, link: string): Promise<MarkResult> {
  const cm = sessionCommitment(token);
  const prior = async (stance?: Stance): Promise<MarkResult | null> => {
    const e = await findPriv({ session: cm });
    if (!e) return null;
    if (stance && e.entry.stance !== stance) return { ok: false, status: 409, reason: 'this session has already recorded its stance; a session records one mark' };
    return { ok: true, receipt: await receiptFor(e.index), fresh: false, observation: null };
  };
  const s0 = await getSession(token);
  const earlier = await prior(s0 && Object.prototype.hasOwnProperty.call(s0.links, link) ? s0.links[link] : undefined);
  if (earlier) return earlier; // a session that already has a mark never gets a second one, even after an error
  const c = await claimSession(token, link);
  if (!c.ok) {
    if (c.reason === 'used') return (await prior(c.session?.links[link])) ?? { ok: false, status: 409, reason: 'session already used' };
    if (c.reason === 'unknown' || c.reason === 'bad-link') return { ok: false, status: 404, reason: 'no such session link' };
    if (c.reason === 'expired') return { ok: false, status: 410, reason: 'this session has passed its deadline; it counts as no endorsement' };
    return { ok: false, status: 409, reason: 'open the session page first' };
  }
  const sess = c.session;
  if (!ALL.includes(c.stance)) { await releaseSession(token); return { ok: false, status: 404, reason: 'no such session link' }; }
  try {
    const obs = await observe(req);
    if (obs.sigError) { await releaseSession(token); return { ok: false, status: 401, reason: `signature: ${obs.sigError}` }; }
    if (!obs.eligible) { await releaseSession(token); return { ok: false, status: 403, reason: 'crawlers and indexers do not leave marks' }; }
    const doc = docById(sess.doc)!;
    const receipt = await append({
      type: 'mark', doc: { url: doc.url, sha256: doc.sha256 }, stance: c.stance, binding: 'session', shown: sess.shown, session: cm, panel: sess.panel,
      platform: obs.platform, assurance: obs.assurance, registry: registry().sha256,
      evidence: [{ type: 'session', panel: sess.panel, commitment: cm, prompt: PROMPT_ID, assignedPlatform: sess.platform, openedFrom: sess.openPlatform ?? null, opensBeforeMark: sess.opens, foreignOpensBeforeMark: sess.foreignOpens ?? 0,
        link, links: sess.links, linksSalt: sess.linksSalt }, ...obs.evidence],
    }, { priv: { ip: ipHash(clientAddress(req) || 'unknown'), session: cm, panel: sess.panel, platform: obs.platform, doc: sess.doc, stance: c.stance }, withCode: true });
    await setSessionLeaf(token, receipt.index);
    return { ok: true, receipt, fresh: true, observation: obs };
  } catch (e) {
    await releaseSession(token);
    throw e;
  }
}

// ---- transcripts -----------------------------------------------------------------------------------------------
const compact = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Attach a shared conversation to a mark. Three things must hold, or anyone could "prove" a mark by typing its code
 * into a chat: (1) the page is on an assistant's own site (registry); (2) the mark itself was observed coming from the
 * SAME operator's own, non-programmable infrastructure; (3) the page shows the mark's receipt code, and for a review
 * session also the session URL it was started from. We fetch it once and say what we found; anyone can re-check.
 */
export async function corroborate(code: string, url: string): Promise<{ ok: true; receipt: Receipt; already: boolean } | { ok: false; status: number; reason: string }> {
  const index = await findByCode(code);
  if (index === null) return { ok: false, status: 404, reason: 'no mark with that receipt code' };
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, status: 400, reason: 'not a URL' }; }
  u.hash = ''; u.search = '';
  const where = transcriptPlatform(u.href);
  if (!where) return { ok: false, status: 400, reason: 'that is not a shared-conversation link on a registered assistant site (see /readmarks/1/origins)' };
  const mark = await receiptFor(index);
  if (mark.entry.type !== 'mark') return { ok: false, status: 400, reason: 'that code is not a mark' };
  const mp = (mark.entry.platform as string | null) ?? null;
  if (!mp || mark.entry.assurance === 'declared' || programmable(mp) || operatorOf(mp) !== where.operator) {
    return { ok: false, status: 409, reason: `a transcript on ${where.operator}'s site can only back a mark that was observed coming from ${where.operator}'s own assistant; this mark was not` };
  }
  const dup = await findPriv({ mark: mark.leafHash, url: u.href });
  if (dup) return { ok: true, receipt: await receiptFor(dup.index), already: true };

  let body = '';
  // Test hook, never active in production builds: transcript pages supplied by the test suite instead of the network.
  const fixtures: Record<string, string> | null = process.env.NODE_ENV !== 'production' && process.env.READMARKS_TEST_HOOKS === '1' && process.env.READMARKS_TEST_TRANSCRIPTS
    ? JSON.parse((await import('node:fs')).readFileSync(process.env.READMARKS_TEST_TRANSCRIPTS, 'utf8')) : null;
  if (fixtures) {
    if (!(u.href in fixtures)) return { ok: false, status: 422, reason: 'could not open the link' };
    body = fixtures[u.href];
  } else try {
    // Follow redirects by hand (g.co -> gemini.google.com), and only to URLs that are themselves registered share links.
    let cur = u.href, res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      res = await fetch(cur, { signal: ctl.signal, redirect: 'manual', headers: { 'user-agent': 'Readmarks-transcript-check/1.0 (+https://www.sgai.sg/protocols/readmarks/1.0)', accept: 'text/html,application/json;q=0.9,*/*;q=0.5' } });
      clearTimeout(timer);
      if (res.status < 300 || res.status >= 400) break;
      const next = new URL(res.headers.get('location') ?? '', cur); next.hash = ''; next.search = '';
      if (!transcriptPlatform(next.href)) return { ok: false, status: 422, reason: 'the link redirected away from the assistant site' };
      cur = next.href; res = null;
    }
    if (!res) return { ok: false, status: 422, reason: 'too many redirects' };
    if (!res.ok) return { ok: false, status: 422, reason: `the assistant site answered HTTP ${res.status}; the link may be private, deleted or closed to automated checks` };
    body = Buffer.from(await res.arrayBuffer()).subarray(0, 5_000_000).toString('utf8');
  } catch {
    return { ok: false, status: 422, reason: 'could not open the link' };
  }
  const hay = compact(body.replace(/\\u002d/gi, '-').replace(/<[^>]{0,200}>/g, ''));
  const want = compact(mark.code ?? '');
  if (!want || !hay.includes(want)) return { ok: false, status: 422, reason: 'the shared page does not show this receipt code' };
  let sessionShown: boolean | undefined, promptShown: boolean | undefined;
  if (mark.entry.binding === 'session') {
    const token = sessionTokenShown(String(mark.entry.session), body);
    sessionShown = !!token;
    if (!token) return { ok: false, status: 422, reason: 'the shared page does not show the session URL this review was registered with' };
    // The standard prompt, word for word, must be on the page (compared on letters and digits, so markup does not matter).
    promptShown = compact(body.replace(/<[^>]{0,200}>/g, '')).includes(compact(STANDARD_PROMPT.replace('{url}', `https://www.sgai.sg/readmarks/1/e/${token}`)));
  }
  const receipt = await append({ type: 'corroboration', mark: mark.leafHash,
    evidence: [{ type: 'transcript', platform: where.platform, url: u.href, check: 'receipt-code-found', ...(sessionShown ? { sessionUrlShown: true, standardPromptShown: !!promptShown } : {}), checkedBy: 'publisher' }] },
  { priv: { mark: mark.leafHash, url: u.href } });
  return { ok: true, receipt, already: false };
}

/** The session token shown on the page, if it hashes to this commitment. */
function sessionTokenShown(commitment: string, body: string): string | null {
  for (const m of body.matchAll(/readmarks\/1\/e\/([A-Za-z0-9_-]{22})/g)) if (sessionCommitment(m[1]) === commitment) return m[1];
  return null;
}

// ---- counting rules ----------------------------------------------------------------------------------------------
// Everything below is computed from the public log alone, exactly as an outside auditor would compute it.
export const COUNT_CAP_PER_HOUR = 20;

/** Wilson score interval (95%) for k successes in n trials. */
export function wilson(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.959964, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}

export type ReviewRow = {
  panel: string | null;                            // null = all of the publisher's own panels pooled; otherwise one panel of another registrant
  registrant: string | null;                       // the name that registrant gave (unverified), if still published
  platform: string; operator: string; registeredBy: 'publisher' | 'other';
  registered: number; pending: number; resolved: number;
  outcomes: Record<Stance | 'none', number>;      // one outcome per resolved session; "none" = unused, abandoned, opened or marked from the wrong place
  endorsedWithTranscript: number;                 // endorsements whose public transcript (showing the standard prompt) we confirmed
  rate: number | null; interval: [number, number] | null; // endorsedWithTranscript / resolved (intention-to-treat)
};
export type DocStats = {
  id: string; url: string; sha256: string;
  reviews: ReviewRow[];
  reviewTranscripts: { platform: string; stance: Stance; url: string; code: string | null; time: string; registeredBy: string }[];
  field: {
    totals: Record<Stance, { declared: number; observed: number; proven: number }>;
    platforms: { platform: string; operator: string | null; programmable: boolean; marks: Record<Stance, number>; counted: number; logged: number }[];
  };
};

let statsCache: { at: number; size: number; value: { logSize: number; documents: DocStats[] } } | null = null;

export async function stats(now?: number): Promise<{ logSize: number; documents: DocStats[] }> {
  const n = await size();
  // The figures are a pure function of the log (and of the clock, for deadlines): reuse them for a minute.
  if (now === undefined && statsCache && Date.now() - statsCache.at < 60_000) return statsCache.value; // at most one full read a minute per instance
  const value = await computeStats(n, now ?? Date.now());
  if (now === undefined) statsCache = { at: Date.now(), size: n, value };
  return value;
}

async function computeStats(n: number, now: number): Promise<{ logSize: number; documents: DocStats[] }> {
  // The whole log, read in pages: figures must never be computed from a truncated log.
  const all: Awaited<ReturnType<typeof entries>> = [];
  for (let from = 0; from < n; from += 2000) all.push(...(await entries(from, 2000)));
  const blank = () => Object.fromEntries(ALL.map((x) => [x, 0])) as Record<Stance, number>;
  const out: DocStats[] = RM_DOCUMENTS.map((d) => ({ id: d.id, url: d.url, sha256: d.sha256, reviews: [], reviewTranscripts: [],
    field: { totals: Object.fromEntries(ALL.map((x) => [x, { declared: 0, observed: 0, proven: 0 }])) as DocStats['field']['totals'], platforms: [] } }));
  const docOf = (e: Entry) => { const d = e.doc as { url: string; sha256: string } | undefined; return d ? out.find((o) => o.url === d.url && o.sha256 === d.sha256) ?? null : null; };

  const transcriptsFor = new Map<string, { platform: string; url: string; prompt: boolean }[]>();
  const sessionMark = new Map<string, { e: Entry; hash: string; code: string | null }>();
  for (const x of all) {
    if (x.entry.type === 'corroboration') {
      const ev = (x.entry.evidence as Evidence[]).find((v) => v.type === 'transcript');
      if (ev) transcriptsFor.set(x.entry.mark as string, [...(transcriptsFor.get(x.entry.mark as string) ?? []), { platform: String(ev.platform), url: String(ev.url), prompt: ev.standardPromptShown === true }]);
    }
    if (x.entry.type === 'mark' && x.entry.binding === 'session' && !sessionMark.has(String(x.entry.session))) sessionMark.set(String(x.entry.session), { e: x.entry, hash: x.leafHash, code: x.code });
  }

  // C2: registered reviews, intention-to-treat. The publisher's own panels are pooled; every other panel stands alone,
  // so nobody can drag a document's rate down (or up) by registering sessions under someone else's row.
  const names = await texts(all.filter((x) => x.entry.type === 'panel').map((x) => x.index));
  for (const x of all) {
    if (x.entry.type !== 'panel') continue;
    const d = docOf(x.entry);
    if (!d) continue;
    const by = x.entry.registeredBy === 'publisher' ? 'publisher' : 'other';
    const panel = by === 'publisher' ? null : String(x.entry.panel);
    const deadline = new Date(x.entry.time).getTime() + Number(x.entry.deadlineDays ?? SESSION_DAYS) * 86_400_000;
    for (const sx of x.entry.sessions as { platform: string; commitment: string }[]) {
      let row = d.reviews.find((r) => r.platform === sx.platform && r.panel === panel);
      if (!row) { row = { panel, registrant: names.get(x.index)?.registrant?.text ?? null, platform: sx.platform, operator: operatorOf(sx.platform) ?? sx.platform, registeredBy: by,
        registered: 0, pending: 0, resolved: 0, outcomes: { ...blank(), none: 0 }, endorsedWithTranscript: 0, rate: null, interval: null }; d.reviews.push(row); }
      row.registered++;
      const m = sessionMark.get(sx.commitment);
      if (!m) { if (now < deadline) row.pending++; else { row.resolved++; row.outcomes.none++; } continue; }
      row.resolved++;
      const sev = (m.e.evidence as Evidence[]).find((v) => v.type === 'session');
      // A session counts only if it was opened by, and marked from, the assistant it was assigned to, and from nowhere else.
      const valid = m.e.assurance !== 'declared' && fromAssigned((m.e.platform as string | null) ?? null, sx.platform)
        && fromAssigned((sev?.openedFrom as string | null) ?? null, sx.platform) && Number(sev?.foreignOpensBeforeMark ?? 0) === 0;
      const st = m.e.stance as Stance;
      row.outcomes[valid && ALL.includes(st) ? st : 'none']++;
      const ts = (transcriptsFor.get(m.hash) ?? []).filter((t) => t.prompt && operatorOf(t.platform) === operatorOf(sx.platform));
      if (valid && ts.length) {
        if (st === 'endorse') row.endorsedWithTranscript++;
        d.reviewTranscripts.push({ platform: sx.platform, stance: st, url: ts[0].url, code: m.code, time: m.e.time, registeredBy: by });
      }
    }
  }
  for (const d of out) for (const r of d.reviews) { r.rate = r.resolved ? r.endorsedWithTranscript / r.resolved : null; r.interval = wilson(r.endorsedWithTranscript, r.resolved); }

  // C1: ordinary marks. Attributed marks are counted in log order, at most 20 per platform per document per UTC hour.
  const hour = new Map<string, number>();
  for (const x of all) {
    if (x.entry.type !== 'mark' || x.entry.binding === 'session') continue;
    const d = docOf(x.entry);
    if (!d) continue; // a mark on another version of the text: logged, not shown against this one
    const e = x.entry as Entry & { stance: Stance; platform: string | null; assurance: 'declared' | 'observed' | 'proven' };
    if (!ALL.includes(e.stance) || !['declared', 'observed', 'proven'].includes(e.assurance)) continue; // never trust a malformed entry
    const level = (transcriptsFor.get(x.leafHash) ?? []).length ? 'proven' : e.assurance;
    d.field.totals[e.stance][level]++;
    if (level === 'declared' || !e.platform) continue;
    const k = `${d.id}|${e.platform}|${e.time.slice(0, 13)}`;
    const seen = hour.get(k) ?? 0;
    hour.set(k, seen + 1);
    let row = d.field.platforms.find((p) => p.platform === e.platform);
    if (!row) { row = { platform: e.platform, operator: operatorOf(e.platform), programmable: programmable(e.platform), marks: blank(), counted: 0, logged: 0 }; d.field.platforms.push(row); }
    row.logged++;
    if (seen < COUNT_CAP_PER_HOUR) { row.marks[e.stance]++; row.counted++; }
  }
  for (const d of out) { d.field.platforms.sort((a, b) => b.counted - a.counted); d.reviews.sort((a, b) => (a.registeredBy === b.registeredBy ? b.resolved - a.resolved : a.registeredBy === 'publisher' ? -1 : 1)); }
  return { logSize: n, documents: out };
}

export { texts, panelSessions };
