// The Readmarks public log: a Merkle tree (RFC 6962) of entries, with signed checkpoints (C2SP tlog-checkpoint) and
// static-style tiles (C2SP tlog-tiles). Anyone can verify inclusion and append-only growth without trusting us.
//
// Mongo collections (Singapore cluster):
//   readmarks_leaves  { _id: index, bytes: <JCS entry, exact>, hash: <hex leaf hash>, code?: receipt code, priv: {...} }
//   readmarks_nodes   { _id: "<height>/<index>", h: <hex> }      memoised complete-subtree hashes (immutable)
//   readmarks_text    { _id: index, fields: { name: { salt, text } } }   free text behind salted commitments (redactable)
//   readmarks_meta    { _id: "checkpoint", size, note }
// `priv` and readmarks_text salts are never served except as the spec says.
import crypto from 'node:crypto';
import { connectToDatabase } from '@/lib/mongodb';
import { RM_VERSION, jcs, publisherKey } from './core';
import { completeNode, inclusionProof, leafHash, rootHash, type Hash, type NodeStore } from './merkle';
import { checkpointBody, signNote, vkey } from './note';

export const LOG_ORIGIN = 'sgai.sg/readmarks/1';
export const MAX_ENTRY_BYTES = 16_000; // tlog-tiles entry bundles carry a uint16 length; we stay far below 65,535

export type Evidence = Record<string, unknown> & { type: string };
export type Entry = {
  readmarks: string;
  type: 'document' | 'mark' | 'corroboration' | 'panel';
  time: string;
  [k: string]: unknown;
};
type LeafDoc = { _id: number; bytes: string; hash: string; code?: string; priv?: Record<string, unknown> };

let ready = false;
async function db() {
  const m = await connectToDatabase();
  const d = m.connection.db!;
  if (!ready) {
    await d.collection('readmarks_leaves').createIndex({ code: 1 }, { unique: true, sparse: true });
    await d.collection('readmarks_leaves').createIndex({ 'priv.ip': 1, 'priv.at': -1 });
    await d.collection('readmarks_leaves').createIndex({ 'priv.platform': 1, 'priv.at': -1 });
    await d.collection('readmarks_leaves').createIndex({ 'priv.mark': 1 });
    ready = true;
  }
  return d;
}

// Immutable values, so a small in-process cache is safe.
const memo = new Map<string, Hash>();
const remember = (k: string, v: Hash) => { memo.set(k, v); if (memo.size > 20_000) memo.delete(memo.keys().next().value as string); return v; };

export async function store(): Promise<NodeStore> {
  const d = await db();
  return {
    async leaf(i) {
      const k = `L/${i}`;
      const hit = memo.get(k);
      if (hit) return hit;
      const doc = await d.collection<LeafDoc>('readmarks_leaves').findOne({ _id: i }, { projection: { hash: 1 } });
      if (!doc) throw new Error(`Readmarks leaf ${i} missing`);
      return remember(k, Buffer.from(doc.hash, 'hex'));
    },
    async get(h, i) {
      const k = `${h}/${i}`;
      const hit = memo.get(k);
      if (hit) return hit;
      const doc = await d.collection<{ _id: string; h: string }>('readmarks_nodes').findOne({ _id: k });
      return doc ? remember(k, Buffer.from(doc.h, 'hex')) : null;
    },
    async put(h, i, v) {
      const k = `${h}/${i}`;
      remember(k, v);
      await d.collection<{ _id: string; h: string }>('readmarks_nodes').updateOne({ _id: k }, { $setOnInsert: { h: v.toString('hex') } }, { upsert: true });
    },
  };
}

export async function size(): Promise<number> {
  const d = await db();
  const head = await d.collection<LeafDoc>('readmarks_leaves').findOne({}, { sort: { _id: -1 }, projection: { _id: 1 } });
  return head ? head._id + 1 : 0;
}

function pubRaw(): Buffer {
  return Buffer.from(publisherKey().jwk.x, 'base64url');
}
export const logVkey = () => vkey(LOG_ORIGIN, pubRaw());

/** The current signed checkpoint. The root is a pure function of the leaves, so two calls can never disagree. */
export async function checkpoint(): Promise<{ size: number; root: Hash; note: string }> {
  const d = await db();
  const n = await size();
  const cached = await d.collection<{ _id: string; size: number; root: string; note: string }>('readmarks_meta').findOne({ _id: 'checkpoint' });
  if (cached && cached.size === n) return { size: n, root: Buffer.from(cached.root, 'hex'), note: cached.note };
  const root = await rootHash(await store(), n);
  const note = signNote(checkpointBody(LOG_ORIGIN, n, root), LOG_ORIGIN, publisherKey().priv, pubRaw());
  await d.collection<{ _id: string; size: number; root: string; note: string }>('readmarks_meta').updateOne(
    { _id: 'checkpoint', $or: [{ size: { $lt: n } }, { size: { $exists: false } }] }, { $set: { size: n, root: root.toString('hex'), note } }, { upsert: true },
  ).catch(() => undefined); // a concurrent, newer checkpoint already stored: fine
  return { size: n, root, note };
}

// Receipt codes: RM1- plus 12 Crockford base32 characters (60 bits) of the leaf hash.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function receiptCode(hash: Hash): string {
  let bits = BigInt('0x' + hash.subarray(0, 8).toString('hex')) >> BigInt(4), s = '';
  for (let i = 0; i < 12; i++) { s = B32[Number(bits & BigInt(31))] + s; bits >>= BigInt(5); }
  return `RM1-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^RM1/, '').replace(/[ILO]/g, (x) => ({ I: '1', L: '1', O: '0' }[x] as string));
const canonicalCode = (c: string) => { const n = normalizeCode(c); return n.length === 12 ? `RM1-${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8)}` : null; };

/** A salted commitment to a free-text field: the leaf carries the hash; text and salt live in readmarks_text and can be withdrawn. */
export function commit(text: string): { commitment: string; salt: string; text: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  return { commitment: crypto.createHash('sha256').update(`${salt}\n${text}`).digest('hex'), salt, text };
}

export type Receipt = { code: string | null; index: number; leafHash: string; entry: Entry; checkpoint: string; treeSize: number; inclusionProof: string[] };

/** Appends one entry. The unique _id (= leaf index) makes concurrent appends retry, so the tree never forks. */
export async function append(body: Omit<Entry, 'readmarks' | 'time'>, opts: { priv?: Record<string, unknown>; text?: Record<string, { salt: string; text: string }>; withCode?: boolean } = {}): Promise<Receipt> {
  const d = await db();
  const leaves = d.collection<LeafDoc>('readmarks_leaves');
  for (let attempt = 0; attempt < 10; attempt++) {
    const index = await size();
    const entry = { readmarks: RM_VERSION, time: new Date().toISOString(), ...body } as Entry;
    const bytes = jcs(entry);
    if (Buffer.byteLength(bytes) > MAX_ENTRY_BYTES) throw new Error('Readmarks entry too large');
    const hash = leafHash(Buffer.from(bytes, 'utf8'));
    const code = opts.withCode ? receiptCode(hash) : undefined;
    try {
      await leaves.insertOne({ _id: index, bytes, hash: hash.toString('hex'), ...(code ? { code } : {}), priv: { ...(opts.priv ?? {}), at: new Date() } });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) { await new Promise((r) => setTimeout(r, 15 + Math.random() * 60)); continue; }
      throw e;
    }
    if (opts.text && Object.keys(opts.text).length) await d.collection<{ _id: number; fields: unknown }>('readmarks_text').insertOne({ _id: index, fields: opts.text });
    return receiptFor(index);
  }
  throw new Error('Readmarks log busy');
}

export async function receiptFor(index: number): Promise<Receipt> {
  const d = await db();
  const doc = await d.collection<LeafDoc>('readmarks_leaves').findOne({ _id: index }, { projection: { priv: 0 } });
  if (!doc) throw new Error('no such leaf');
  const cp = await checkpoint();
  const proof = await inclusionProof(await store(), index, cp.size);
  return { code: doc.code ?? null, index, leafHash: doc.hash, entry: JSON.parse(doc.bytes), checkpoint: cp.note, treeSize: cp.size, inclusionProof: proof.map((h) => h.toString('hex')) };
}

export async function findByCode(code: string): Promise<number | null> {
  const c = canonicalCode(code);
  if (!c) return null;
  const doc = await (await db()).collection<LeafDoc>('readmarks_leaves').findOne({ code: c }, { projection: { _id: 1 } });
  return doc ? doc._id : null;
}

export async function findPriv(filter: Record<string, unknown>): Promise<{ index: number; entry: Entry; code?: string } | null> {
  const q: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) q[`priv.${k}`] = v;
  const doc = await (await db()).collection<LeafDoc>('readmarks_leaves').findOne(q, { sort: { _id: -1 } });
  return doc ? { index: doc._id, entry: JSON.parse(doc.bytes), code: doc.code } : null;
}

export async function findAllPriv(filter: Record<string, unknown>, limit = 50): Promise<{ index: number; entry: Entry; code?: string }[]> {
  const q: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) q[`priv.${k}`] = v;
  const docs = await (await db()).collection<LeafDoc>('readmarks_leaves').find(q, { sort: { _id: 1 }, limit }).toArray();
  return docs.map((doc) => ({ index: doc._id, entry: JSON.parse(doc.bytes), code: doc.code }));
}

export async function countSince(filter: Record<string, unknown>, since: Date): Promise<number> {
  const q: Record<string, unknown> = { 'priv.at': { $gte: since } };
  for (const [k, v] of Object.entries(filter)) q[`priv.${k}`] = v;
  return (await db()).collection('readmarks_leaves').countDocuments(q);
}

/** Entries [from, from + limit) as JSON, for people and agents that cannot parse tiles. */
export async function entries(from: number, limit: number): Promise<{ index: number; leafHash: string; code: string | null; entry: Entry }[]> {
  const docs = await (await db()).collection<LeafDoc>('readmarks_leaves').find({ _id: { $gte: from } }, { sort: { _id: 1 }, limit, projection: { priv: 0 } }).toArray();
  return docs.map((x) => ({ index: x._id, leafHash: x.hash, code: x.code ?? null, entry: JSON.parse(x.bytes) }));
}

export async function texts(indexes: number[]): Promise<Map<number, Record<string, { salt: string; text: string }>>> {
  const docs = await (await db()).collection<{ _id: number; fields: Record<string, { salt: string; text: string }> }>('readmarks_text').find({ _id: { $in: indexes } }).toArray();
  return new Map(docs.map((x) => [x._id, x.fields]));
}

// ---- C2SP tlog-tiles -------------------------------------------------------------------------------------------
const TILE = 256;

/** Hash tile: level L (each level is 8 binary levels), tile index N, width W (1..256). Null if not all of it exists yet. */
export async function hashTile(level: number, n: number, width: number): Promise<Buffer | null> {
  const total = await size();
  const span = Math.pow(TILE, level);
  const have = Math.floor(total / span) - n * TILE; // complete nodes available at this level from this tile's start
  if (level < 0 || level > 6 || width < 1 || width > TILE || have < width) return null;
  const s = await store();
  const out: Hash[] = [];
  for (let i = 0; i < width; i++) out.push(await completeNode(s, 8 * level, n * TILE + i));
  return Buffer.concat(out);
}

/** Entry bundle: entries [256 N, 256 N + W), each prefixed by its length as a big-endian uint16. */
export async function entryBundle(n: number, width: number): Promise<Buffer | null> {
  const total = await size();
  if (width < 1 || width > TILE || total - n * TILE < width) return null;
  const docs = await (await db()).collection<LeafDoc>('readmarks_leaves').find({ _id: { $gte: n * TILE, $lt: n * TILE + width } }, { sort: { _id: 1 }, projection: { bytes: 1 } }).toArray();
  if (docs.length !== width) return null;
  return Buffer.concat(docs.flatMap((x) => { const b = Buffer.from(x.bytes, 'utf8'); const len = Buffer.alloc(2); len.writeUInt16BE(b.length); return [len, b]; }));
}

/** Parses a tlog-tiles path tail such as ["0","x001","x234","067"] or ["entries","000.p","5"]. */
export function parseTilePath(parts: string[]): { kind: 'hash' | 'entries'; level: number; n: number; width: number } | null {
  if (parts.length < 2) return null;
  const kind = parts[0] === 'entries' ? 'entries' : 'hash';
  const level = kind === 'hash' ? Number(parts[0]) : 0;
  if (kind === 'hash' && !/^(0|[1-9]\d?)$/.test(parts[0])) return null;
  let rest = parts.slice(1), width = TILE;
  if (rest.length >= 2 && rest[rest.length - 2].endsWith('.p')) {
    const w = rest[rest.length - 1];
    if (!/^[1-9]\d{0,2}$/.test(w) || Number(w) > 255) return null;
    width = Number(w);
    rest = [...rest.slice(0, -2), rest[rest.length - 2].slice(0, -2)];
  }
  let n = 0;
  for (let i = 0; i < rest.length; i++) {
    const last = i === rest.length - 1;
    const m = last ? /^(\d{3})$/.exec(rest[i]) : /^x(\d{3})$/.exec(rest[i]);
    if (!m) return null;
    n = n * 1000 + Number(m[1]);
  }
  if (!Number.isSafeInteger(n)) return null;
  return { kind, level, n, width };
}
