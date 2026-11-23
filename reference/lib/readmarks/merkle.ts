// Merkle tree hashing and proofs exactly as RFC 6962 section 2.1 (the Certificate Transparency construction).
//   leaf hash  = SHA-256(0x00 || leaf bytes)
//   node hash  = SHA-256(0x01 || left || right)
//   MTH(D[n])  splits at k = the largest power of two smaller than n.
// Hashes of COMPLETE subtrees never change once their leaves exist, so they are memoised through `NodeStore`.
import crypto from 'node:crypto';

export type Hash = Buffer;
export const EMPTY_ROOT: Hash = crypto.createHash('sha256').digest();
export const leafHash = (leaf: Buffer): Hash => crypto.createHash('sha256').update(Buffer.from([0])).update(leaf).digest();
export const nodeHash = (l: Hash, r: Hash): Hash => crypto.createHash('sha256').update(Buffer.from([1])).update(l).update(r).digest();

/** Storage the tree needs: leaf hashes by index, and a cache for complete-subtree hashes keyed by (height, index). */
export interface NodeStore {
  leaf(index: number): Promise<Hash>;
  get(height: number, index: number): Promise<Hash | null>;
  put(height: number, index: number, hash: Hash): Promise<void>;
}

/** Hash of the complete subtree of the given height whose leaves are [index * 2^height, (index + 1) * 2^height). */
export async function completeNode(s: NodeStore, height: number, index: number): Promise<Hash> {
  if (height === 0) return s.leaf(index);
  const hit = await s.get(height, index);
  if (hit) return hit;
  const [l, r] = await Promise.all([completeNode(s, height - 1, index * 2), completeNode(s, height - 1, index * 2 + 1)]);
  const h = nodeHash(l, r);
  await s.put(height, index, h);
  return h;
}

const largestPow2Below = (n: number) => { let k = 1; while (k * 2 < n) k *= 2; return k; };

/** MTH(D[start:end]) for 0 <= start < end. Aligned power-of-two ranges come from the memoised complete nodes. */
export async function rangeHash(s: NodeStore, start: number, end: number): Promise<Hash> {
  const n = end - start;
  if (n <= 0) throw new Error('empty range');
  if ((n & (n - 1)) === 0 && start % n === 0) return completeNode(s, Math.log2(n), start / n);
  const k = largestPow2Below(n);
  const [l, r] = await Promise.all([rangeHash(s, start, start + k), rangeHash(s, start + k, end)]);
  return nodeHash(l, r);
}

export async function rootHash(s: NodeStore, size: number): Promise<Hash> {
  return size === 0 ? EMPTY_ROOT : rangeHash(s, 0, size);
}

/** RFC 6962 2.1.1: audit path for leaf m in a tree of the first `size` leaves. */
export async function inclusionProof(s: NodeStore, m: number, size: number): Promise<Hash[]> {
  if (m < 0 || m >= size) throw new Error('leaf index out of range');
  const path = async (i: number, start: number, end: number): Promise<Hash[]> => {
    const n = end - start;
    if (n === 1) return [];
    const k = largestPow2Below(n);
    if (i < k) return [...(await path(i, start, start + k)), await rangeHash(s, start + k, end)];
    return [...(await path(i - k, start + k, end)), await rangeHash(s, start, start + k)];
  };
  return path(m, 0, size);
}

/** RFC 6962 2.1.2: consistency proof between the first m leaves and the first n leaves (0 < m <= n). */
export async function consistencyProof(s: NodeStore, m: number, n: number): Promise<Hash[]> {
  if (m <= 0 || m > n) throw new Error('bad sizes');
  const sub = async (mm: number, start: number, end: number, whole: boolean): Promise<Hash[]> => {
    const nn = end - start;
    if (mm === nn) return whole ? [] : [await rangeHash(s, start, end)];
    const k = largestPow2Below(nn);
    if (mm <= k) return [...(await sub(mm, start, start + k, whole)), await rangeHash(s, start + k, end)];
    return [...(await sub(mm - k, start + k, end, false)), await rangeHash(s, start, start + k)];
  };
  return sub(m, 0, n, true);
}

/** RFC 9162 2.1.3.2: recompute the root from a leaf hash and its audit path. */
export function rootFromInclusion(leaf: Hash, index: number, size: number, proof: Hash[]): Hash {
  if (index >= size) throw new Error('index out of range');
  let fn = index, sn = size - 1, r = leaf;
  for (const p of proof) {
    if (sn === 0) throw new Error('proof too long');
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  if (sn !== 0) throw new Error('proof too short');
  return r;
}

/** RFC 9162 2.1.4.2: check that a tree of size n with root `second` extends the tree of size m with root `first`. */
export function verifyConsistency(m: number, n: number, first: Hash, second: Hash, proof: Hash[]): boolean {
  if (m === n) return proof.length === 0 && first.equals(second);
  if (m <= 0 || m > n) return false;
  let path = proof.slice();
  if ((m & (m - 1)) === 0) path = [first, ...path];
  let fn = m - 1, sn = n - 1;
  while (fn % 2 === 1) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
  if (!path.length) return false;
  let fr = path[0], sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr); sr = nodeHash(c, sr);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else {
      sr = nodeHash(sr, c);
    }
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && fr.equals(first) && sr.equals(second);
}
