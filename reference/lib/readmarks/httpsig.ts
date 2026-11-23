// Verifies an RFC 9421 HTTP Message Signature made with Ed25519, with the key taken from a Web Bot Auth key
// directory (Signature-Agent header -> https://<host>/.well-known/http-message-signatures-directory).
// On success it returns everything a third party needs to re-verify the signature later without trusting us:
// the covered component values in order, the raw signature parameters, the signature and the public key.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { thumbprint } from './core';

export type SigEvidence = {
  agent: string;               // origin of the key directory, e.g. https://chatgpt.com
  keyid: string;               // RFC 7638 thumbprint of the signing key
  jwk: { kty: string; crv: string; x: string };
  label: string;
  params: string;              // the raw inner list with parameters, exactly as received (the "@signature-params" value)
  components: [string, string][]; // covered component identifiers (as signed, e.g. "@path" or "signature-agent";key="g") and the values we used
  signature: string;           // base64
  created: number;
  expires: number;
  tag: string | null;
  bindsPath: boolean;          // true when the signature covers @path or @target-uri, so it commits to this exact URL
};
export type SigResult = { ok: true; evidence: SigEvidence } | { ok: false; reason: string; ignored?: boolean } | null; // null = no signature present; ignored = signer not in the registry

const MAX_WINDOW_S = 86_400; // single-use tickets, not short windows, stop replays; agents in the field sign for up to an hour
const DIR_PATH = '/.well-known/http-message-signatures-directory';

type Component = { name: string; id: string; key: string | null };

/** Parses the Signature-Input dictionary; prefers the member tagged web-bot-auth. */
function parseSigInput(header: string): { label: string; raw: string; components: Component[]; params: Record<string, string | number>; bad?: string } | null {
  const members: string[] = [];
  let depth = 0, q = false, cur = '';
  for (const ch of header) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { members.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) members.push(cur.trim());
  const parsed = members.map((m) => {
    const mm = /^([a-z*][a-z0-9_.*-]*)=(\((.*?)\)((?:;[a-z*][a-z0-9_.*-]*=(?:"[^"\\]*"|-?\d+))*))$/.exec(m);
    if (!mm) return null;
    // Each covered component is "name" optionally followed by parameters, e.g. "signature-agent";key="g" (RFC 9421 2.1.2).
    const components: Component[] = [];
    let bad: string | undefined;
    for (const c of mm[3].matchAll(/"([^"\\]*)"((?:;[a-z*][a-z0-9_.*-]*(?:="[^"\\]*")?)*)/g)) {
      const ps = [...c[2].matchAll(/;([a-z*][a-z0-9_.*-]*)(?:="([^"\\]*)")?/g)];
      const other = ps.find((x) => x[1] !== 'key');
      if (other) bad = `unsupported component parameter ;${other[1]}`;
      components.push({ name: c[1], id: `"${c[1]}"${c[2]}`, key: ps.find((x) => x[1] === 'key')?.[2] ?? null });
    }
    const params: Record<string, string | number> = {};
    for (const p of mm[4].matchAll(/;([a-z*][a-z0-9_.*-]*)=(?:"([^"\\]*)"|(-?\d+))/g)) params[p[1]] = p[2] !== undefined ? p[2] : Number(p[3]);
    return { label: mm[1], raw: mm[2], components, params, bad };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  return parsed.find((p) => p.params.tag === 'web-bot-auth') ?? parsed[0] ?? null;
}

/** One member of a structured-field dictionary header, serialised as sent (e.g. "https://agent.bot.goog"). */
function dictMember(header: string, key: string): string | null {
  let q = false, cur = '';
  const members: string[] = [];
  for (const ch of header) {
    if (ch === '"') q = !q;
    if (!q && ch === ',') { members.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) members.push(cur.trim());
  for (const m of members) {
    const eq = m.indexOf('=');
    if (eq > 0 && m.slice(0, eq) === key) return m.slice(eq + 1).trim();
  }
  return null;
}

function parseSignature(header: string, label: string): Buffer | null {
  for (const m of header.matchAll(/([a-z*][a-z0-9_.*-]*)=:([A-Za-z0-9+/=]+):/g)) if (m[1] === label) return Buffer.from(m[2], 'base64');
  return null;
}

/** Signature-Agent is a quoted https URL (string form) or a dictionary with one such member per signature (newer drafts). */
function agentDirectory(value: string, memberKey: string | null, label: string): URL | null {
  const member = (memberKey && dictMember(value, memberKey)) || dictMember(value, label);
  const m = /^"([^"\\]+)"/.exec(member ?? '') ?? /^\s*"([^"\\]+)"\s*$/.exec(value) ?? /^\s*(https:\/\/\S+)\s*$/.exec(value);
  if (!m) return null;
  let u: URL;
  try { u = new URL(m[1]); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  return new URL(DIR_PATH, u.origin);
}

export function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const s = ip.toLowerCase();
  if (s.startsWith('::ffff:')) return privateAddress(s.slice(7));
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') ||
    s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff');
}

type Jwk = { kty?: string; crv?: string; x?: string };
const dirCache = new Map<string, { at: number; keys: Jwk[] }>();

async function fetchDirectory(url: URL): Promise<Jwk[]> {
  const hit = dirCache.get(url.href);
  if (hit && Date.now() - hit.at < 600_000) return hit.keys;
  if (net.isIP(url.hostname)) throw new Error('directory host must be a name');
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error('directory host resolves to a private address');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(url, { redirect: 'error', signal: ctl.signal, headers: { accept: 'application/http-message-signatures-directory+json, application/json' } });
    if (!res.ok || !res.body) throw new Error(`directory HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { ctl.abort(); throw new Error('directory too large'); }
      chunks.push(value);
    }
    const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const keys: Jwk[] = Array.isArray(json?.keys) ? json.keys.slice(0, 20) : [];
    dirCache.set(url.href, { at: Date.now(), keys });
    if (dirCache.size > 500) dirCache.delete(dirCache.keys().next().value as string);
    return keys;
  } finally {
    clearTimeout(t);
  }
}

/** Test hook: pre-load a key directory (bypasses DNS/fetch). Not reachable from any route. */
export function seedDirectoryForTest(url: string, keys: Jwk[]) {
  dirCache.set(url, { at: Date.now(), keys });
}
// Test hook, never active in production builds: key directories supplied by the test suite.
if (process.env.NODE_ENV !== 'production' && process.env.READMARKS_TEST_HOOKS === '1' && process.env.READMARKS_TEST_DIRECTORIES) {
  try { for (const [u, keys] of Object.entries(JSON.parse(process.env.READMARKS_TEST_DIRECTORIES) as Record<string, Jwk[]>)) dirCache.set(u, { at: Date.now() + 3600_000, keys }); } catch { /* ignore */ }
}

/** The signature base of RFC 9421 section 2.5, from stored component values. Third parties use the same function. */
export function signatureBase(components: [string, string][], params: string): Buffer {
  return Buffer.from([...components.map(([id, v]) => `${id}: ${v}`), `"@signature-params": ${params}`].join('\n'), 'utf8');
}

/**
 * Verify the request's signature. `body` is the exact raw request body (empty for GET). `allowedAgents` are the
 * signer origins of the origin registry.
 * Required coverage follows the IETF draft (draft-ietf-webbotauth-httpsig-protocol): @authority or @target-uri, and
 * signature-agent when that header is sent; with a body we also require content-digest.
 * `bindsPath` says whether the signature also commits to this exact URL (@path or @target-uri): only then is it
 * evidence for one particular request that a third party can check.
 */
export async function verifyRequest(req: Request, body: Buffer, allowedAgents: string[], now = Date.now()): Promise<SigResult> {
  const si = req.headers.get('signature-input');
  const sg = req.headers.get('signature');
  const sa = req.headers.get('signature-agent');
  if (!si && !sg) return null;
  if (!si || !sg || !sa) return { ok: false, reason: 'signature, signature-input and signature-agent are all required' };
  if (si.length > 2048 || sg.length > 2048 || sa.length > 512) return { ok: false, reason: 'signature headers too long' };
  const input = parseSigInput(si);
  if (!input) return { ok: false, reason: 'unparseable signature-input' };
  if (input.bad) return { ok: false, reason: input.bad };
  const names = input.components.map((c) => c.name);
  if (!names.includes('@authority') && !names.includes('@target-uri')) return { ok: false, reason: 'signature must cover @authority or @target-uri' };
  if (!names.includes('signature-agent')) return { ok: false, reason: 'signature must cover signature-agent' };
  if (body.length && !names.includes('content-digest')) return { ok: false, reason: 'signature must cover content-digest when there is a body' };
  if (input.params.alg !== undefined && input.params.alg !== 'ed25519') return { ok: false, reason: 'alg must be ed25519' };
  const created = Number(input.params.created), expires = Number(input.params.expires), nowS = Math.floor(now / 1000);
  if (!Number.isInteger(created) || !Number.isInteger(expires)) return { ok: false, reason: 'created and expires are required' };
  if (expires - created > MAX_WINDOW_S || created > nowS + 60 || expires < nowS) return { ok: false, reason: 'signature outside its validity window' };
  if (typeof input.params.keyid !== 'string') return { ok: false, reason: 'keyid required' };
  const sig = parseSignature(sg, input.label);
  if (!sig || sig.length !== 64) return { ok: false, reason: 'signature value missing for label' };

  if (body.length || names.includes('content-digest')) {
    const m = /sha-256=:([A-Za-z0-9+/=]+):/.exec(req.headers.get('content-digest') ?? '');
    const got = m ? Buffer.from(m[1], 'base64') : null;
    const want = crypto.createHash('sha256').update(body).digest();
    if (!got || got.length !== 32 || !crypto.timingSafeEqual(got, want)) return { ok: false, reason: 'content-digest does not match the body' };
  }

  const url = new URL(req.url);
  const host = (req.headers.get('host') ?? url.host).toLowerCase();
  const components: [string, string][] = [];
  let agentKey: string | null = null;
  for (const c of input.components) {
    let v: string | null;
    if (c.name === '@authority') v = host;
    else if (c.name === '@method') v = req.method.toUpperCase();
    else if (c.name === '@path') v = url.pathname;
    else if (c.name === '@query') v = url.search || '?';
    else if (c.name === '@scheme') v = 'https';
    else if (c.name === '@target-uri') v = `https://${host}${url.pathname}${url.search}`;
    else if (c.name.startsWith('@')) return { ok: false, reason: `unsupported component ${c.name}` };
    else if (c.key !== null) { v = dictMember(req.headers.get(c.name) ?? '', c.key); if (c.name === 'signature-agent') agentKey = c.key; }
    else v = req.headers.get(c.name);
    if (c.name.startsWith('@') && c.key !== null) return { ok: false, reason: `parameters are not allowed on ${c.name}` };
    if (v === null) return { ok: false, reason: `missing header or member for ${c.id}` };
    components.push([c.id, v.trim()]);
  }
  const base = signatureBase(components, input.raw);

  const dir = agentDirectory(sa, agentKey, input.label);
  if (!dir) return { ok: false, reason: 'signature-agent must name an https origin' };
  // We fetch key directories only for signers listed in the origin registry. A directory named by an unknown party
  // would be an outbound request an attacker controls, so such a signature is ignored: the request counts as unsigned.
  if (!allowedAgents.includes(dir.origin)) return { ok: false, reason: 'signer is not in the origin registry', ignored: true };
  let keys: Jwk[];
  try { keys = await fetchDirectory(dir); } catch { return { ok: false, reason: 'the signer\'s key directory could not be read' }; }
  const jwk = keys.find((k) => k?.kty === 'OKP' && k?.crv === 'Ed25519' && typeof k?.x === 'string' && thumbprint(k) === input.params.keyid);
  if (!jwk) return { ok: false, reason: 'keyid not found in the key directory' };
  const pub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x as string }, format: 'jwk' });
  if (!crypto.verify(null, base, pub, sig)) return { ok: false, reason: 'signature does not verify' };
  return { ok: true, evidence: { agent: dir.origin, keyid: input.params.keyid, jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x as string },
    label: input.label, params: input.raw, components, signature: sig.toString('base64'), created, expires,
    tag: typeof input.params.tag === 'string' ? input.params.tag : null, bindsPath: names.includes('@path') || names.includes('@target-uri') } };
}
