// Shared helpers for the Readmarks route handlers.
import { NextResponse } from 'next/server';
import { ipHash } from '@/lib/readmarks/core';
import { clientAddress } from '@/lib/readmarks/origins';
import { findAllPriv, findByCode, receiptFor, size, texts, type Evidence, type Receipt } from '@/lib/readmarks/log';

export const CORS = { 'access-control-allow-origin': '*' };
export const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store', ...extra } });
export const ipH = (req: Request) => ipHash(clientAddress(req) || 'unknown');
export const wantsHtml = (req: Request) => (req.headers.get('accept') ?? '').includes('text/html') || (req.headers.get('content-type') ?? '').includes('form');

/** A string field: control and bidi-override characters removed, whitespace collapsed; null if out of range. */
export function clean(s: unknown, max: number): string | undefined | null {
  if (s === undefined || s === null || s === '') return undefined;
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

export async function readBody(req: Request, max = 4096): Promise<Buffer | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  const b = Buffer.from(await req.arrayBuffer());
  return b.length > max ? null : b;
}

/** A receipt by code or by leaf index, with its public transcripts and any free text behind its commitments. */
export async function fullReceipt(ref: string): Promise<{ receipt: Receipt; transcripts: { platform: string; url: string }[]; texts: Record<string, { salt: string; text: string }> } | null> {
  let index: number | null = /^\d{1,9}$/.test(ref) ? Number(ref) : await findByCode(ref);
  if (index === null || index >= (await size())) index = null;
  if (index === null) return null;
  const receipt = await receiptFor(index);
  const cs = receipt.entry.type === 'mark' ? await findAllPriv({ mark: receipt.leafHash }) : [];
  const transcripts = cs.flatMap((c) => (c.entry.evidence as Evidence[]).filter((e) => e.type === 'transcript').map((e) => ({ platform: String(e.platform), url: String(e.url) })));
  return { receipt, transcripts, texts: (await texts([index])).get(index) ?? {} };
}

/** Browsers and previewers label speculative requests. They must never advance a marking flow. */
export function isPrefetch(req: Request): boolean {
  const v = `${req.headers.get('sec-purpose') ?? ''} ${req.headers.get('purpose') ?? ''} ${req.headers.get('x-purpose') ?? ''} ${req.headers.get('x-moz') ?? ''}`.toLowerCase();
  return /prefetch|prerender|preview/.test(v);
}
