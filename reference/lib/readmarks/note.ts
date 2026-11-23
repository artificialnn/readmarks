// Checkpoints in the C2SP formats, so standard transparency-log tooling and witnesses can read them:
//   c2sp.org/tlog-checkpoint: "<origin>\n<tree size>\n<base64 root hash>\n"
//   c2sp.org/signed-note:     the text, a blank line, then one line per signature:
//                             "— <key name> <base64(4-byte key ID || signature)>\n"
//   Ed25519 key ID = first 4 bytes of SHA-256(<key name> || 0x0A || 0x01 || <32-byte public key>).
import crypto from 'node:crypto';

export const ED25519_ALG = 0x01;

export function keyId(name: string, pub: Buffer): Buffer {
  return crypto.createHash('sha256').update(Buffer.from(name, 'utf8')).update(Buffer.from([0x0a, ED25519_ALG])).update(pub).digest().subarray(0, 4);
}

/** The verifier key string other tools take: <name>+<hex key ID>+<base64(0x01 || public key)>. */
export function vkey(name: string, pub: Buffer): string {
  return `${name}+${keyId(name, pub).toString('hex')}+${Buffer.concat([Buffer.from([ED25519_ALG]), pub]).toString('base64')}`;
}

export function checkpointBody(origin: string, size: number, root: Buffer): string {
  return `${origin}\n${size}\n${root.toString('base64')}\n`;
}

export function signNote(body: string, name: string, priv: crypto.KeyObject, pub: Buffer): string {
  if (!body.endsWith('\n')) throw new Error('note text must end in a newline');
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), priv);
  return `${body}\n— ${name} ${Buffer.concat([keyId(name, pub), sig]).toString('base64')}\n`;
}

export function openNote(note: string, name: string, pub: Buffer): { body: string; ok: boolean } {
  const cut = note.indexOf('\n\n');
  if (cut < 0) return { body: '', ok: false };
  const body = note.slice(0, cut + 1);
  const id = keyId(name, pub);
  for (const line of note.slice(cut + 2).split('\n')) {
    const m = /^— (\S+) (\S+)$/.exec(line);
    if (!m || m[1] !== name) continue;
    const raw = Buffer.from(m[2], 'base64');
    if (raw.length !== 68 || !raw.subarray(0, 4).equals(id)) continue;
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' });
    if (crypto.verify(null, Buffer.from(body, 'utf8'), key, raw.subarray(4))) return { body, ok: true };
  }
  return { body, ok: false };
}
