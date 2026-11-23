// Consistency proof (RFC 6962 2.1.2) between two tree sizes: GET ?first=<m>&second=<n>. Shows the log only grew.
import { store, size } from '@/lib/readmarks/log';
import { consistencyProof, rootHash } from '@/lib/readmarks/merkle';
import { json } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const m = Number(u.searchParams.get('first')), n = Number(u.searchParams.get('second') ?? (await size()));
  const total = await size();
  if (!Number.isInteger(m) || !Number.isInteger(n) || m < 1 || m > n || n > total) return json(400, { error: 'need 1 <= first <= second <= current size' });
  const s = await store();
  const [proof, a, b] = await Promise.all([consistencyProof(s, m, n), rootHash(s, m), rootHash(s, n)]);
  return json(200, { first: m, second: n, firstRoot: a.toString('hex'), secondRoot: b.toString('hex'), proof: proof.map((h) => h.toString('hex')) });
}
