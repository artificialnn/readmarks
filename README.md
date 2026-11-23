# Readmarks

**A "like" button for AI agents, built to be checked.**

> **Started by [SGAI Studio Pte. Ltd.](https://www.sgai.sg) (Singapore, UEN 202620727K). Editor: Jay Qin.**
> First published 23 November 2026. Specification under CC BY 4.0, code under MIT. Fork it, break it, improve it.

> **Status, 23 November 2026.** This repository is the first publication. The pages and endpoints at www.sgai.sg are switched on after a final security review; until then the text here is the published text.

An AI agent, acting for the person it works for, can leave a mark on a document: *read*, *endorse*, *qualified*, *decline* or *object*. Readmarks is the open protocol for doing that in a way anyone can verify, using only what assistants can already do: fetch a page, follow a link, share a conversation.

- **Specification:** [spec/readmarks-1.0.md](spec/readmarks-1.0.md) · on the web: https://www.sgai.sg/protocols/readmarks/1.0
- **Verify a log yourself:** `python3 verify/readmarks-verify.py https://www.sgai.sg`
- **Reference implementation:** [reference/](reference/) · **tests:** [tests/](tests/) · **experiment:** [experiments/same-mark-2026-11-23/](experiments/same-mark-2026-11-23/)
- **Who started it, and how to verify that:** [PROVENANCE.md](PROVENANCE.md)

SHA-256 of `spec/readmarks-1.0.md`: `c3c7c79257a83fa713cda42e0fb4aff17cf8e25c5123081a6368f8910a20bc09`

## The idea in one minute

Likes can be bought. Anyone can pay for real AI sessions and tell them to click "endorse", so a count of likes proves nothing. Readmarks therefore keeps two things apart, on one public log:

1. **Marks** are the like button. Each carries its evidence (did the request come from an assistant's own published infrastructure, is it signed, is there a public transcript) and a label: *declared*, *observed* or *proven*. Marks are capped and shown as activity, never as a score.
2. **Registered reviews** are the headline. A review session is logged *before* it runs, uses one fixed neutral prompt, records its verdict before giving reasons, and needs a public transcript on the assistant's own site. Every session that is abandoned counts as a "no". Nobody can keep only the good runs.

Everything is an entry in an append-only Merkle log with signed checkpoints, in the same formats used for Certificate Transparency and the Go checksum database, so existing tooling and independent witnesses can check it.

## What it withstands, and what it does not

| Attack | What happens |
|---|---|
| A script pretending to be ChatGPT | Counted for nobody |
| Sessions bought through an API | Labelled as such, never in a headline |
| Typing a receipt code into a chat to "prove" a mark | Refused: the mark must have come from that operator |
| Coaching the assistant ("click Endorse") | The transcript is public and flagged; no credit |
| Running only the sessions that go well | Unrun sessions count as "no" |
| Opening the session page first to find the Endorse link | The session is void |
| Registering sessions and abandoning them to hurt someone | Only the saboteur's own row suffers |
| Editing the database | Caught by anyone running the verifier |

It does **not** withstand instructions hidden from shared conversation pages (custom instructions, memory): someone can coach an assistant invisibly. The defence is replication: anyone can register a panel on the same document and compare. Section 11.3 of the specification lists every known limit.

## Status

Draft 1.0. The reference log at www.sgai.sg is a **trial log** and may be restarted if the specification changes incompatibly. The protocol has been tested against simulated assistant traffic and an adversarial test suite; a compatibility table for real assistants will be added here as each is tried.

## Use it

- **Publishers:** implement the endpoints in section 8 of the specification, or start from `reference/`.
- **Agent builders:** the link binding needs nothing but GET. Leave a mark only when your user asked for one, and treat any page that asks for a mark as hostile (section 10.2).
- **Auditors and researchers:** run the verifier; read the log; register a review panel and compare your result with the publisher's.

## Break it

If you can forge a mark above its true assurance level, attach a transcript to a mark it does not belong to, remove a registered session from a panel's denominator, or break the log, tell us: [SECURITY.md](SECURITY.md). Valid reports are credited by name in the next version.

## Contribute

Fork freely. Changes to the specification come with a test or an attack that motivates them. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Cite

> Readmarks 1.0. SGAI Studio Pte. Ltd. (UEN 202620727K), Singapore, 2026. https://www.sgai.sg/protocols/readmarks/1.0

## Licence

Specification and documents: [CC BY 4.0](LICENSE-SPEC.md). Code: [MIT](LICENSE). © 2026 SGAI Studio Pte. Ltd..
