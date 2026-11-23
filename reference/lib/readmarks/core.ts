// Readmarks 1.0: canonical JSON, the publisher key, address hashing. Spec: content/protocols/readmarks-1.0.md
import crypto from 'node:crypto';

export const RM_VERSION = '1.0';
export const ORIGIN = 'https://www.sgai.sg';
export const PUBLISHER = {
  name: 'SGAI Studio',
  legalName: 'SGAI Studio Pte. Ltd.',
  identifier: { propertyID: 'UEN', value: '202620727K', issuer: 'ACRA Singapore' },
  url: ORIGIN,
};

/** RFC 8785 (JCS) for the value types Readmarks allows: no floats, no undefined. */
export function jcs(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error('Readmarks: only safe integers allowed');
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`;
  }
  throw new Error('Readmarks: unsupported JSON value');
}

export const sha256hex = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
export const b64url = (b: Buffer) => b.toString('base64url');

/** RFC 7638 thumbprint of an Ed25519 OKP JWK. */
export function thumbprint(jwk: { crv?: string; kty?: string; x?: string }): string {
  return b64url(crypto.createHash('sha256').update(jcs({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest());
}

let keyCache: { priv: crypto.KeyObject; jwk: { kid: string; kty: string; crv: string; x: string; use: string; alg: string } } | null = null;

/** The publisher signing key: READMARKS_SIGNING_KEY = base64 PKCS#8 DER of an Ed25519 private key. */
export function publisherKey() {
  if (keyCache) return keyCache;
  const raw = process.env.READMARKS_SIGNING_KEY;
  if (!raw) throw new Error('READMARKS_SIGNING_KEY missing');
  const priv = crypto.createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv).export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
  const jwk = { kty: pub.kty, crv: pub.crv, x: pub.x, kid: thumbprint(pub), use: 'sig', alg: 'EdDSA' };
  keyCache = { priv, jwk };
  return keyCache;
}

export function sign(bytes: string): { sig: string; kid: string } {
  const k = publisherKey();
  return { sig: b64url(crypto.sign(null, Buffer.from(bytes, 'utf8'), k.priv)), kid: k.jwk.kid };
}

function secret(): Buffer {
  const s = process.env.READMARKS_SECRET;
  if (!s || s.length < 32) throw new Error('READMARKS_SECRET missing');
  return Buffer.from(s, 'utf8');
}

/** Salted hash of the client address for rate limits only; the salt rotates daily and is never published. */
export function ipHash(ip: string, now = Date.now()): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return crypto.createHmac('sha256', secret()).update(`readmarks-ip|${day}|${ip}`).digest('hex').slice(0, 32);
}
