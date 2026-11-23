// Readmarks 1.0 discovery file. Names the publisher (with its UEN), the documents that accept marks (each with the SHA-256
// of its exact bytes and the publisher's signature over that claim), the endpoints, the log's verifier key, the origin
// registry digest and the standard review prompt.
import { NextResponse } from 'next/server';
import { RM_DOCUMENTS, RM_ORIGINS_SHA256, RM_QUESTIONS_SHA256 } from '@/lib/readmarks/spec.generated';
import { RM_VERSION, ORIGIN, PUBLISHER, jcs, publisherKey, sign } from '@/lib/readmarks/core';
import { LOG_ORIGIN, logVkey } from '@/lib/readmarks/log';
import { PROMPT_ID, STANDARD_PROMPT } from '@/lib/readmarks/sessions';
import { STANCES, STANCE_TEXT } from '@/lib/readmarks/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export function GET() {
  const { jwk } = publisherKey();
  const documents = RM_DOCUMENTS.map((d) => {
    const claim = { url: d.url, version: d.version, sha256: d.sha256, publisher: PUBLISHER.legalName, uen: PUBLISHER.identifier.value };
    return { ...claim, page: d.page, title: d.title, markingPage: `${ORIGIN}/readmarks/1/t/${d.id}`, readingCheckBank: RM_QUESTIONS_SHA256[d.id], sig: sign(jcs(claim)).sig, kid: jwk.kid };
  });
  const A = `${ORIGIN}/readmarks/1`;
  return NextResponse.json({
    readmarks: RM_VERSION,
    spec: `${ORIGIN}/protocols/readmarks/1.0`,
    publisher: PUBLISHER,
    keys: [jwk],
    documents,
    documentSignature: 'sig = Ed25519 over JCS({url, version, sha256, publisher, uen}), base64url, key kid',
    stances: Object.fromEntries(STANCES.map((s) => [s, STANCE_TEXT[s][1]])),
    bindings: {
      link: { markingPage: `${A}/t/{document id}` },
      http: { tickets: `${A}/tickets`, marks: `${A}/marks` },
    },
    reviews: { register: `${A}/panels`, panel: `${A}/p/{panel}`, prompt: { id: PROMPT_ID, text: STANDARD_PROMPT }, transcript: `${A}/corroborations` },
    log: { trial: true, trialNote: 'Readmarks 1.0 is a draft. This log may be closed and replaced if the specification changes incompatibly; a closed log stays downloadable.', origin: LOG_ORIGIN, vkey: logVkey(), checkpoint: `${A}/log/checkpoint`, tiles: `${A}/log/tile/`, entries: `${A}/log/entries`, consistency: `${A}/log/proof`, receipt: `${A}/r/{code}/json` },
    originRegistry: { url: `${A}/origins`, sha256: RM_ORIGINS_SHA256, snapshots: `${A}/blob/{sha256}` },
    stats: `${A}/stats`,
  }, { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } });
}
