// Known-answer tests: the Certificate Transparency reference vectors for RFC 6962 roots, plus proof round-trips.
import crypto from 'node:crypto';
const M = await import('../reference/lib/readmarks/merkle.ts');
const N = await import('../reference/lib/readmarks/note.ts');
const leaves = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map((h) => Buffer.from(h, 'hex'));
const roots = ['6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d', 'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77', 'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4', '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c', '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328'];
const mk = (ls: Buffer[]) => { const cache = new Map<string, Buffer>(); let puts = 0;
  return { store: { leaf: async (i: number) => M.leafHash(ls[i]), get: async (h: number, i: number) => cache.get(`${h}/${i}`) ?? null, put: async (h: number, i: number, v: Buffer) => { cache.set(`${h}/${i}`, v); puts++; } }, puts: () => puts }; };
let fail = 0; const t = (ok: boolean, name: string) => { if (!ok) { fail++; console.log('FAIL', name); } };
t(M.EMPTY_ROOT.toString('hex') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'empty root');
const { store } = mk(leaves);
for (let n = 1; n <= 8; n++) t((await M.rootHash(store, n)).toString('hex') === roots[n - 1], `CT vector root size ${n}`);
console.log(fail ? 'vectors FAILED' : 'PASS 8 RFC 6962 reference roots + empty root');
// Proof round-trips on random trees up to 300 leaves.
const big = [...Array(300)].map((_, i) => crypto.createHash('sha256').update(`leaf ${i}`).digest());
const b = mk(big); let checks = 0;
for (const n of [1, 2, 3, 7, 8, 9, 64, 65, 127, 128, 129, 255, 256, 257, 300]) {
  const root = await M.rootHash(b.store, n);
  for (const m of new Set([0, 1, Math.floor(n / 2), n - 2, n - 1].filter((x) => x >= 0 && x < n))) {
    const p = await M.inclusionProof(b.store, m, n);
    t(M.rootFromInclusion(M.leafHash(big[m]), m, n, p).equals(root), `inclusion ${m}/${n}`); checks++;
    const bad = M.leafHash(Buffer.from('forged'));
    t(!M.rootFromInclusion(bad, m, n, p).equals(root), `forged leaf rejected ${m}/${n}`); checks++;
  }
  for (const m of new Set([1, 2, 3, Math.floor(n / 2), n - 1, n].filter((x) => x >= 1 && x <= n))) {
    const p = await M.consistencyProof(b.store, m, n);
    t(M.verifyConsistency(m, n, await M.rootHash(b.store, m), root, p), `consistency ${m}->${n}`); checks++;
    if (m < n) { t(!M.verifyConsistency(m, n, M.leafHash(Buffer.from('other history')), root, p), `rewritten history rejected ${m}->${n}`); checks++; }
  }
}
console.log(fail ? `${fail} FAILED` : `PASS ${checks} inclusion/consistency checks (incl. forged leaf and rewritten history rejected)`);
// Signed note round-trip and tamper check.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pub = Buffer.from((publicKey.export({ format: 'jwk' }) as any).x, 'base64url');
const note = N.signNote(N.checkpointBody('example.com/log', 8, Buffer.from(roots[7], 'hex')), 'example.com/log', privateKey, pub);
t(N.openNote(note, 'example.com/log', pub).ok, 'note verifies');
t(!N.openNote(note.replace('\n8\n', '\n9\n'), 'example.com/log', pub).ok, 'tampered note rejected');
console.log(fail ? 'note FAILED' : 'PASS signed note round-trip + tamper');
console.log(note);
process.exit(fail);
