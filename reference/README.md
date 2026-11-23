# Reference implementation

TypeScript, extracted from the Next.js 16 application that serves https://www.sgai.sg. It is the code that runs the reference log.

| Path | What it is |
|---|---|
| `lib/readmarks/merkle.ts` | RFC 6962 tree hashing, inclusion and consistency proofs |
| `lib/readmarks/note.ts` | C2SP signed notes (checkpoints) |
| `lib/readmarks/log.ts` | The log on MongoDB: append, receipts, tiles |
| `lib/readmarks/httpsig.ts` | RFC 9421 / Web Bot Auth verification, with transferable evidence |
| `lib/readmarks/origins.ts` | The origin registry: operators' address lists, reverse DNS, signatures |
| `lib/readmarks/tickets.ts`, `sessions.ts` | Tickets (link and HTTP bindings) and registered review sessions |
| `lib/readmarks/mark.ts` | Recording marks, attaching transcripts, counting rules C1 and C2 |
| `lib/readmarks/pages.ts`, `html.ts` | The script-free pages an agent sees |
| `app/readmarks/1/**` | Route handlers (the endpoints of the specification) |
| `app/.well-known/readmarks.json` | The discovery file |
| `scripts/` | Build step (digests, registry, question bank) and housekeeping |

Not included: `lib/readmarks/spec.generated.ts`, which the build step writes and which holds the answers to the reading-check questions.

Environment variables (names only): `MONGODB_URI`, `READMARKS_SIGNING_KEY` (Ed25519 private key, PKCS#8 DER, base64), `READMARKS_SECRET` (rate-limit hashing), `READMARKS_PUBLISHER_KEY` (marks a panel as the publisher's), `READMARKS_PUBLIC` (the site serves the protocol only when this is `1`). The `READMARKS_TEST_*` hooks are read only when `NODE_ENV` is not `production`.

MIT licence. Started by SGAI Studio Pte. Ltd. (UEN 202620727K).
