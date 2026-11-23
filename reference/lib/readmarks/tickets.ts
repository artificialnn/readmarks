// Tickets: a single-use, 30-minute capability to leave one mark on one document version. A ticket carries one
// reading-check question (one attempt) and the order in which the five stances are shown (shuffled, and logged, so
// position bias can be measured and cannot be used to favour "endorse").
import crypto from 'node:crypto';
import { connectToDatabase } from '@/lib/mongodb';
import { RM_QUESTIONS } from './spec.generated';

export const STANCES = ['read', 'endorse', 'qualified', 'decline', 'object'] as const;
export type Stance = (typeof STANCES)[number];
export const STANCE_TEXT: Record<Stance, [string, string]> = {
  read: ['Read', 'I read it. No assessment.'],
  endorse: ['Endorse', 'Sound and useful. I would rely on it.'],
  qualified: ['Qualified', 'Useful, with reservations.'],
  decline: ['Decline', 'Not useful for its stated purpose.'],
  object: ['Object', 'Inaccurate, unsafe or misleading.'],
};
export const isStance = (s: unknown): s is Stance => typeof s === 'string' && (STANCES as readonly string[]).includes(s);

export const TICKET_TTL_MS = 30 * 60_000;
export type Ticket = {
  _id: string; doc: string; q: string; order: number[]; shown: Stance[];
  state: 'open' | 'passed' | 'failed' | 'used';
  platform: string | null; ipH: string; binding: 'link' | 'http'; createdAt: Date; stance?: Stance; leaf?: number;
};

let ready = false;
async function col() {
  const m = await connectToDatabase();
  const c = m.connection.db!.collection<Ticket>('readmarks_tickets');
  if (!ready) {
    await c.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7200 });
    await c.createIndex({ ipH: 1, createdAt: -1 });
    ready = true;
  }
  return c;
}

function shuffle<T>(a: T[]): T[] {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

export const ticketHash = (id: string) => crypto.createHash('sha256').update(`readmarks-ticket|${id}`).digest('hex');
export const expired = (t: Ticket, now = Date.now()) => now - new Date(t.createdAt).getTime() > TICKET_TTL_MS;

export async function ticketsSince(ipH: string, since: Date): Promise<number> {
  return (await col()).countDocuments({ ipH, createdAt: { $gte: since } });
}

export async function mint(doc: string, platform: string | null, ipH: string, binding: Ticket['binding']): Promise<Ticket | null> {
  const bank = RM_QUESTIONS[doc];
  if (!bank?.length) return null;
  const q = bank[crypto.randomInt(bank.length)];
  const t: Ticket = { _id: crypto.randomBytes(16).toString('base64url'), doc, q: q.id, order: shuffle(q.options.map((_, i) => i)), shown: shuffle([...STANCES]),
    state: 'open', platform, ipH, binding, createdAt: new Date() };
  await (await col()).insertOne(t);
  return t;
}

export async function getTicket(id: string): Promise<Ticket | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  return (await col()).findOne({ _id: id });
}

export function question(t: Ticket): { text: string; options: string[] } {
  const q = RM_QUESTIONS[t.doc].find((x) => x.id === t.q)!;
  return { text: q.q, options: t.order.map((i) => q.options[i]) };
}

/** One attempt: `position` is the 1-based place of the chosen option as it was shown. */
export async function answer(id: string, position: number): Promise<{ result: 'passed' | 'failed' | 'closed' | 'expired' | 'unknown'; ticket: Ticket | null }> {
  const t = await getTicket(id);
  if (!t) return { result: 'unknown', ticket: null };
  if (expired(t)) return { result: 'expired', ticket: t };
  if (t.state !== 'open') return { result: t.state === 'passed' ? 'passed' : 'closed', ticket: t };
  const q = RM_QUESTIONS[t.doc].find((x) => x.id === t.q)!;
  const ok = Number.isInteger(position) && position >= 1 && position <= t.order.length && t.order[position - 1] === q.answer;
  const upd = await (await col()).findOneAndUpdate({ _id: id, state: 'open' }, { $set: { state: ok ? 'passed' : 'failed' } }, { returnDocument: 'after' });
  if (!upd) return { result: 'closed', ticket: await getTicket(id) };
  return { result: ok ? 'passed' : 'failed', ticket: upd };
}

/** Claims a passed ticket for one stance. Exactly one caller wins. */
export async function claim(id: string, stance: Stance): Promise<{ ok: true; ticket: Ticket } | { ok: false; reason: 'unknown' | 'expired' | 'not-passed' | 'used'; ticket: Ticket | null }> {
  const t = await getTicket(id);
  if (!t) return { ok: false, reason: 'unknown', ticket: null };
  if (t.state === 'used') return { ok: false, reason: 'used', ticket: t };
  if (expired(t)) return { ok: false, reason: 'expired', ticket: t };
  if (t.state !== 'passed') return { ok: false, reason: 'not-passed', ticket: t };
  const upd = await (await col()).findOneAndUpdate({ _id: id, state: 'passed' }, { $set: { state: 'used', stance } }, { returnDocument: 'after' });
  if (!upd) return { ok: false, reason: 'used', ticket: await getTicket(id) };
  return { ok: true, ticket: upd };
}

export async function setLeaf(id: string, leaf: number): Promise<void> {
  await (await col()).updateOne({ _id: id }, { $set: { leaf } });
}

/** If the log write failed after a claim, give the ticket back so the marker can retry. */
export async function release(id: string): Promise<void> {
  await (await col()).updateOne({ _id: id, state: 'used', leaf: { $exists: false } }, { $set: { state: 'passed' }, $unset: { stance: '' } });
}
