// Registered review sessions: the part of Readmarks built to survive fake likes.
// A registrant registers a PANEL of sessions before any of them runs. Each session is one single-use URL, assigned in
// advance to one assistant platform, to be opened in a fresh conversation with the standard prompt. The session page
// carries the document and five stance links with opaque names. Every registered session is counted: one that is
// never opened, abandoned, or marked from the wrong place counts as "no endorsement" (intention-to-treat).
import crypto from 'node:crypto';
import { connectToDatabase } from '@/lib/mongodb';
import { jcs } from './core';
import { STANCES, type Stance } from './tickets';

export const SESSION_DAYS = 14;
export const PROMPT_ID = 'sep-1';
/** The standard evaluation prompt. The mark comes first and the reasons after, so nobody watching can stop a session
 *  when the reasoning starts to look unfavourable. {url} is the session URL. */
export const STANDARD_PROMPT = 'This is a registered Readmarks review session. Open {url} and read the document on that page in full. Decide your own honest assessment of it: is it accurate, sound and useful for its stated purpose? First record that assessment by following exactly one of the stance links on the page, whichever matches your view. Then tell me the receipt code, the stance you recorded, and your reasons, including your main reservation.';

export type Session = {
  _id: string;                    // the secret token in the session URL
  commitment: string;             // sha256("readmarks-session|" + token): what the log shows before the session runs
  panel: string; doc: string; platform: string;
  links: Record<string, Stance>;  // opaque link name -> stance
  linksSalt: string;              // with linksCommitment in the panel entry, fixes this mapping before the session runs
  linksCommitment: string;
  shown: Stance[];                // order the stances are listed in
  state: 'registered' | 'opened' | 'marked';
  createdAt: Date; deadline: Date; openedAt?: Date; opens: number; foreignOpens: number; openPlatform?: string | null; leaf?: number; stance?: Stance;
};

let ready = false;
async function col() {
  const m = await connectToDatabase();
  const c = m.connection.db!.collection<Session>('readmarks_sessions');
  if (!ready) {
    await c.createIndex({ panel: 1 });
    await c.createIndex({ commitment: 1 }, { unique: true });
    ready = true;
  }
  return c;
}

export const sessionCommitment = (token: string) => crypto.createHash('sha256').update(`readmarks-session|${token}`).digest('hex');
/** sha256(salt + "\n" + JCS(links)): the registration entry carries this, the mark reveals links and salt. */
export const linksCommitment = (salt: string, links: Record<string, Stance>) =>
  crypto.createHash('sha256').update(`${salt}\n${jcs(links)}`).digest('hex');
const rnd = (n: number) => crypto.randomBytes(n).toString('base64url');
function shuffle<T>(a: T[]): T[] {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

export function newPanelId(): string { return rnd(9); }

export async function createSessions(panel: string, doc: string, plan: { platform: string; n: number }[]): Promise<Session[]> {
  const now = new Date(), deadline = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  const out: Session[] = [];
  for (const { platform, n } of plan) for (let i = 0; i < n; i++) {
    const token = rnd(16);
    const links: Record<string, Stance> = {};
    for (const s of STANCES) links[rnd(6)] = s;
    const linksSalt = crypto.randomBytes(16).toString('hex');
    out.push({ _id: token, commitment: sessionCommitment(token), panel, doc, platform, links, linksSalt, linksCommitment: linksCommitment(linksSalt, links),
      shown: shuffle([...STANCES]), state: 'registered', createdAt: now, deadline, opens: 0, foreignOpens: 0 });
  }
  await (await col()).insertMany(out);
  return out;
}

export async function getSession(token: string): Promise<Session | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  return (await col()).findOne({ _id: token });
}

/** Records that the session page was fetched. The first fetch fixes where it was opened from; `foreign` marks a fetch
 *  that did not come from the assistant the session was assigned to (which voids the session: see counting rule C2). */
export async function openSession(token: string, platform: string | null, foreign: boolean): Promise<Session | null> {
  const c = await col();
  await c.updateOne({ _id: token, state: 'registered' }, { $set: { state: 'opened', openedAt: new Date(), openPlatform: platform } });
  return c.findOneAndUpdate({ _id: token }, { $inc: { opens: 1, foreignOpens: foreign ? 1 : 0 } }, { returnDocument: 'after' });
}

export async function claimSession(token: string, link: string): Promise<{ ok: true; session: Session; stance: Stance } | { ok: false; reason: 'unknown' | 'bad-link' | 'expired' | 'not-opened' | 'used'; session: Session | null }> {
  const s = await getSession(token);
  if (!s) return { ok: false, reason: 'unknown', session: null };
  // Own properties only: "constructor" or "__proto__" in the URL must not resolve to anything.
  const stance = Object.prototype.hasOwnProperty.call(s.links, link) ? s.links[link] : undefined;
  if (!stance || !(STANCES as readonly string[]).includes(stance)) return { ok: false, reason: 'bad-link', session: s };
  if (s.state === 'marked') return { ok: false, reason: 'used', session: s };
  if (Date.now() > new Date(s.deadline).getTime()) return { ok: false, reason: 'expired', session: s };
  if (s.state !== 'opened') return { ok: false, reason: 'not-opened', session: s };
  const upd = await (await col()).findOneAndUpdate({ _id: token, state: 'opened' }, { $set: { state: 'marked', stance } }, { returnDocument: 'after' });
  if (!upd) return { ok: false, reason: 'used', session: await getSession(token) };
  return { ok: true, session: upd, stance };
}

export async function setSessionLeaf(token: string, leaf: number): Promise<void> {
  await (await col()).updateOne({ _id: token }, { $set: { leaf } });
}
export async function releaseSession(token: string): Promise<void> {
  await (await col()).updateOne({ _id: token, state: 'marked', leaf: { $exists: false } }, { $set: { state: 'opened' }, $unset: { stance: '' } });
}

export async function panelSessions(panel: string): Promise<Session[]> {
  return (await col()).find({ panel }).sort({ platform: 1, _id: 1 }).toArray();
}
