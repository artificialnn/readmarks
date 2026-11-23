// Which agent platform did this request come from? Two kinds of evidence, both using only what operators publish today:
//   origin-signature  the request carries a Web Bot Auth signature (RFC 9421). Anyone can re-verify it later.
//   origin-network    the source address is inside an address list the operator publishes for its agents, or its
//                     reverse DNS name is one the operator documents. We observed it; a third party has our word.
// The list of operators is the Readmarks origin registry (content/protocols/readmarks-origins.json), published and hashed.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { connectToDatabase } from '@/lib/mongodb';
import { RM_ORIGINS, RM_ORIGINS_SHA256 } from './spec.generated';
import { privateAddress, verifyRequest, type SigEvidence } from './httpsig';
import type { Evidence } from './log';

export type Origin = {
  id: string; operator: string; product: string;
  kind: 'user-triggered' | 'agent-browser' | 'crawler';
  eligible: boolean;                 // may this origin leave marks? crawlers and indexers may not
  ua?: string[];                     // User-Agent tokens the operator documents
  ipLists?: string[];                // URLs of the operator's published address lists
  prefixes?: string[];               // address ranges the operator documents on a page rather than in a list
  uaRequired?: boolean;              // the list is shared with other fetchers: this row applies only when its User-Agent token is sent
  rdns?: string[];                   // documented reverse-DNS suffixes (forward-confirmed)
  signatureAgent?: string[];         // Signature-Agent origins the operator documents
  docs: string;                      // the operator's own page that says so
};
const REG = RM_ORIGINS as { version: string; origins: Origin[]; transcripts: { platform: string; operator: string; pattern: string }[] };

export const registry = () => ({ ...REG, sha256: RM_ORIGINS_SHA256 });
export const originById = (id: string) => REG.origins.find((o) => o.id === id) ?? null;

// ---- address lists ---------------------------------------------------------------------------------------------
type ListDoc = { _id: string; url: string; fetchedAt: Date; sha256: string; prefixes: string[] };
const mem = new Map<string, ListDoc>();
const REFRESH_MS = 6 * 3600_000;
const MAX_STALE_MS = 72 * 3600_000;

function ipToBig(ip: string): { v: 4 | 6; n: bigint } | null {
  if (net.isIPv4(ip)) return { v: 4, n: ip.split('.').reduce((a, b) => (a << BigInt(8)) + BigInt(Number(b)), BigInt(0)) };
  if (!net.isIPv6(ip)) return null;
  let s = ip.toLowerCase();
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) { const p = v4[2].split('.').map(Number); s = `${v4[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`; }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;
  return { v: 6, n: groups.reduce((a, g) => (a << BigInt(16)) + BigInt(parseInt(g || '0', 16)), BigInt(0)) };
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, lenS] = cidr.split('/');
  const a = ipToBig(ip), b = ipToBig(base);
  if (!a || !b || a.v !== b.v) return false;
  const bits = a.v === 4 ? 32 : 128, len = lenS === undefined ? bits : Number(lenS);
  if (!Number.isInteger(len) || len < 0 || len > bits) return false;
  const shift = BigInt(bits - len);
  return (a.n >> shift) === (b.n >> shift);
}

/**
 * The prefixes an operator's list declares, read by its structure only: JSON lists ({"prefixes":[{"ipv4Prefix"|"ipv6Prefix"}]})
 * and SAIL files (ipv4_prefixes / ipv6_prefixes arrays). Never scraped by pattern: an HTML page can contain the
 * requester's own address. Anything else yields nothing.
 */
export function extractPrefixes(body: string): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const [base, len] = v.trim().split('/');
    if (!net.isIP(base)) return;
    const c = len === undefined ? `${base}/${net.isIPv4(base) ? 32 : 128}` : `${base}/${len}`;
    if (!privateAddress(base) && Number(c.split('/')[1]) >= (net.isIPv4(base) ? 8 : 16)) out.add(c);
  };
  const t = body.trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { prefixes?: { ipv4Prefix?: unknown; ipv6Prefix?: unknown }[] };
      for (const x of Array.isArray(j.prefixes) ? j.prefixes : []) { add(x?.ipv4Prefix); add(x?.ipv6Prefix); }
    } catch { /* not a list */ }
    return [...out];
  }
  for (const m of t.matchAll(/^\s*ipv[46]_prefixes\s*=\s*\[([\s\S]*?)\]/gm)) for (const q of m[1].matchAll(/"([^"]+)"/g)) add(q[1]);
  return [...out];
}

async function col() {
  const m = await connectToDatabase();
  return m.connection.db!;
}

async function refreshList(url: string): Promise<ListDoc | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(u, { signal: ctl.signal, redirect: 'error', headers: { 'user-agent': 'Readmarks-origin-registry/1.0 (+https://www.sgai.sg/protocols/readmarks/1.0)', accept: 'application/json, text/plain, */*' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > 2_000_000) return null;
    const prefixes = extractPrefixes(body.toString('utf8'));
    if (!prefixes.length) return null;
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const doc: ListDoc = { _id: `iplist:${url}`, url, fetchedAt: new Date(), sha256, prefixes };
    const d = await col();
    await d.collection<ListDoc>('readmarks_meta').replaceOne({ _id: doc._id }, doc, { upsert: true });
    // Keep the exact bytes we relied on, so an auditor can compare them with the operator's list of that day.
    await d.collection<{ _id: string; url: string; fetchedAt: Date; body: string }>('readmarks_blobs').updateOne({ _id: sha256 }, { $setOnInsert: { url, fetchedAt: doc.fetchedAt, body: body.toString('utf8') } }, { upsert: true });
    mem.set(url, doc);
    return doc;
  } catch {
    return null;
  }
}

async function list(url: string): Promise<{ doc: ListDoc | null; stale: boolean }> {
  let doc = mem.get(url) ?? null;
  if (!doc) {
    doc = await (await col()).collection<ListDoc>('readmarks_meta').findOne({ _id: `iplist:${url}` });
    if (doc) mem.set(url, doc);
  }
  if (!doc) return { doc: await refreshList(url), stale: false }; // first use: fetch now
  const age = Date.now() - new Date(doc.fetchedAt).getTime();
  // Cloud addresses are re-assigned. A list we could not refresh for three days proves nothing: fail closed.
  if (age > MAX_STALE_MS) return { doc: await refreshList(url), stale: false };
  return { doc, stale: age > REFRESH_MS };
}

/** Refresh every stale list. Call after the response has been sent. */
export async function refreshStaleLists(): Promise<void> {
  const urls = [...new Set(REG.origins.flatMap((o) => o.ipLists ?? []))];
  for (const u of urls) {
    const { doc, stale } = await list(u);
    if (!doc || stale) await refreshList(u);
  }
}

export async function blob(sha256: string): Promise<{ url: string; fetchedAt: Date; body: string } | null> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  return (await col()).collection<{ _id: string; url: string; fetchedAt: Date; body: string }>('readmarks_blobs').findOne({ _id: sha256 });
}

async function rdnsMatch(ip: string, suffixes: string[]): Promise<string | null> {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    for (const name of names) {
      const n = name.toLowerCase().replace(/\.$/, '');
      const suf = suffixes.find((s) => n === s || n.endsWith(`.${s}`));
      if (!suf) continue;
      const fwd = await dns.lookup(n, { all: true });
      if (fwd.some((a) => a.address === ip)) return suf; // forward-confirmed; we keep the suffix only (PTR names embed the address)
    }
  } catch { /* no PTR */ }
  return null;
}

export type Observation = {
  platform: string | null;          // registry id, or "signed:<origin>" for a valid signature from an unregistered signer
  operator: string | null;
  kind: Origin['kind'] | null;
  eligible: boolean;                // false only for known crawlers
  assurance: 'declared' | 'observed' | 'proven';
  evidence: Evidence[];
  sigError?: string;
  needsRefresh: boolean;
};

export function clientAddress(req: Request): string {
  // Test hook, never active in production builds: lets the test suite present a request as coming from a given address.
  if (process.env.NODE_ENV !== 'production' && process.env.READMARKS_TEST_HOOKS === '1' && req.headers.get('x-readmarks-test-ip')) return String(req.headers.get('x-readmarks-test-ip'));
  // On Vercel these headers are written by the platform, never by the client; x-vercel-forwarded-for cannot be overwritten by a proxy in between.
  return (req.headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
}

const originOf = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };
const SIGNERS = [...new Set(REG.origins.flatMap((o) => o.signatureAgent ?? []).map(originOf).filter(Boolean))];

/** What can we say about where this request came from? */
export async function observe(req: Request, body: Buffer = Buffer.alloc(0)): Promise<Observation> {
  const evidence: Evidence[] = [];
  let platform: string | null = null, entry: Origin | null = null, needsRefresh = false, sigError: string | undefined;
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300);

  const sig = await verifyRequest(req, body, SIGNERS);
  if (sig && !sig.ok && !sig.ignored) sigError = sig.reason;
  const sigEv: SigEvidence | null = sig?.ok ? sig.evidence : null;
  const sigRow = sigEv ? REG.origins.find((o) => (o.signatureAgent ?? []).some((x) => originOf(x) === sigEv.agent)) ?? null : null;
  if (sigEv?.bindsPath && sigRow) {
    // Covers this exact URL: public proof for this request, and the URL is single-use, so it cannot be replayed.
    entry = sigRow; platform = sigRow.id;
    evidence.push({ type: 'origin-signature', platform, ...sigEv });
  }

  const uaHas = (o: Origin) => (o.ua ?? []).some((t) => ua.toLowerCase().includes(t.toLowerCase()));
  const ip = clientAddress(req);
  if (ip && net.isIP(ip) && !privateAddress(ip)) {
    // Every registry row whose published addresses contain this one; rows that share a list are told apart by User-Agent.
    const hits: { o: Origin; ev: Evidence }[] = [];
    for (const o of REG.origins) {
      const fixed = (o.prefixes ?? []).find((p) => inCidr(ip, p));
      if (fixed) { hits.push({ o, ev: { type: 'origin-network', platform: o.id, method: 'documented-range', source: o.docs, prefix: fixed, userAgentMatches: uaHas(o) } }); continue; }
      for (const url of o.ipLists ?? []) {
        const { doc, stale } = await list(url);
        if (stale) needsRefresh = true;
        const prefix = doc?.prefixes.find((p) => inCidr(ip, p));
        if (doc && prefix) {
          hits.push({ o, ev: { type: 'origin-network', platform: o.id, method: 'address-list', list: url, listSha256: doc.sha256, listFetchedAt: new Date(doc.fetchedAt).toISOString(), prefix, userAgentMatches: uaHas(o) } });
          break;
        }
      }
    }
    // Where an operator publishes overlapping lists, the most restrictive reading wins: if the address is in any
    // programmable range, the request is attributed there, whatever its User-Agent says.
    const prog = hits.find((h) => (h.o as Origin & { programmable?: boolean }).programmable);
    const pick = prog ?? hits.find((h) => uaHas(h.o)) ?? hits.find((h) => !h.o.uaRequired && h.o.eligible) ?? hits.find((h) => !h.o.uaRequired) ?? null;
    if (pick) {
      evidence.push(pick.ev);
      if (!entry) { entry = pick.o; platform = pick.o.id; }
    } else if (hits.length) {
      // Inside an operator's shared list but with an unknown User-Agent: we cannot tell a user's fetch from a crawl.
      const crawler = hits.find((h) => !h.o.eligible) ?? hits[0];
      evidence.push({ ...crawler.ev, platform: crawler.o.id, userAgentMatches: false });
      if (!entry) { entry = { ...crawler.o, eligible: false }; platform = crawler.o.id; }
    } else {
      // Reverse DNS only for operators that document it, and only when the User-Agent claims that operator (saves lookups).
      for (const o of REG.origins.filter((x) => x.rdns?.length && uaHas(x))) {
        const suffix = await rdnsMatch(ip, o.rdns as string[]);
        if (suffix) {
          evidence.push({ type: 'origin-network', platform: o.id, method: 'reverse-dns', suffix, userAgentMatches: true });
          if (!entry) { entry = o; platform = o.id; }
          break;
        }
      }
    }
  }
  if (sigEv && !sigEv.bindsPath && sigRow) {
    // An authority-only signature is the same for every request to this site, so whoever has seen one can replay it.
    // It never stands alone: it is noted beside a network match for the same operator, and its value is not published.
    const net = evidence.find((x) => x.type === 'origin-network');
    const corroborated = !!net && originById(String(net.platform))?.operator === sigRow.operator;
    evidence.push({ type: 'origin-signature', platform: sigRow.id, agent: sigEv.agent, keyid: sigEv.keyid, created: sigEv.created, expires: sigEv.expires,
      covered: sigEv.components.map((c) => c[0]), tag: sigEv.tag, bindsPath: false, corroborated });
  }
  const proven = evidence.some((x) => x.type === 'origin-signature' && x.bindsPath === true);
  const observed = evidence.some((x) => x.type === 'origin-network');
  return { platform, operator: entry?.operator ?? null, kind: entry?.kind ?? null, eligible: entry ? entry.eligible : true,
    assurance: proven ? 'proven' : observed ? 'observed' : 'declared', evidence, sigError, needsRefresh };
}

/** Is this URL a shared conversation on a platform's own site? Returns the registry row. */
export function transcriptPlatform(url: string): { platform: string; operator: string } | null {
  for (const t of REG.transcripts) if (new RegExp(t.pattern).test(url)) return { platform: t.platform, operator: t.operator };
  return null;
}
