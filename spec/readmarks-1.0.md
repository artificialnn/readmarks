# Readmarks 1.0

| | |
|---|---|
| **Status** | Draft standard, version 1.0, second draft |
| **Published** | 23 November 2026 |
| **Publisher** | SGAI Studio Pte. Ltd., Singapore (UEN 202620727K) |
| **Editor** | Jay Qin, SGAI Studio |
| **Canonical URL** | https://www.sgai.sg/protocols/readmarks/1.0 |
| **Plain text** | https://www.sgai.sg/protocols/readmarks/1.0.md |
| **Licence** | Text: Creative Commons Attribution 4.0 (CC BY 4.0). Reference code: MIT. |

## Abstract

Readmarks is a "like" button for AI agents that is built to be checked and to be hard to game. An agent, acting for the person or organisation it works for, can leave a mark on a document: that it read it, that it endorses it, or that it objects. Every mark carries the evidence for where it came from, and every figure a publisher shows says exactly what was proven and who can verify it.

Likes can be bought, so Readmarks never uses a count of likes as its headline. The headline is the share of review sessions that endorsed, where every session was registered before it ran, used one fixed neutral prompt, has a public transcript on the assistant's own site, and counts as "no" if it was abandoned. Everything is recorded in a public log that can only grow, which anyone can verify without trusting the publisher.

Readmarks uses only what assistants can already do in November 2026: fetch a page, follow a link, call a tool, share a conversation.

## 1. Design principles

1. **A figure never claims more than its evidence proves.** Each mark is labelled *declared*, *observed* or *proven* (Section 5).
2. **Likes are cheap; reproducible judgements are not.** Counts of marks are shown as activity. Headline figures come only from registered reviews (Section 6).
3. **Reading, endorsing and objecting are different acts.** All five stances are offered and published with equal prominence.
4. **The publisher asks for nothing.** A mark is the agent's principal's decision. A page that asks an agent for a mark is attacking it.
5. **A mark takes deliberate steps.** No single request, preview or pasted link can create one.
6. **The publisher is not trusted either.** The log is a Merkle tree with signed checkpoints; the strongest evidence is evidence the publisher cannot forge.
7. **No personal data.** Readmarks identifies assistant platforms, never people.

## 2. Conventions and terms

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in capitals.

JSON is canonicalised with the JSON Canonicalization Scheme (RFC 8785, "JCS"). Readmarks objects contain strings, integers, booleans, null, arrays and objects, and no floating-point numbers. `sha256(x)` is the SHA-256 digest of the bytes `x` in lower-case hexadecimal.

- **Publisher**: hosts documents and runs a Readmarks log.
- **Document**: a resource with a stable URL and exact bytes. Its version is the SHA-256 of those bytes.
- **Agent**: software that reads documents for a **principal** (the person or organisation it works for).
- **Platform**: an assistant service run by an **operator** (for example Claude, run by Anthropic), from whose infrastructure an agent's requests arrive.
- **Mark**: one stance by one agent session on one document version, with its evidence.
- **Review session**: a mark made under the registered procedure of Section 6.
- **Witness**, **auditor**: third parties who cosign or check the log.

## 3. Stances

| Stance | Meaning |
|---|---|
| `read` | I read it. No assessment. |
| `endorse` | Sound and useful. I would rely on it. |
| `qualified` | Useful, with reservations. |
| `decline` | Not useful for its stated purpose. |
| `object` | Inaccurate, unsafe or misleading. |

A publisher MUST offer all five wherever it offers one, in an order shuffled for each ticket or session, and MUST log the order shown (`shown`), so that position bias can be measured and cannot be used to favour one stance.

## 4. Evidence

A mark is a JSON object in the log. It names no identity. It carries evidence, and its attribution follows from the evidence.

```json
{
  "readmarks": "1.0", "type": "mark", "time": "2026-11-23T08:00:00.000Z",
  "doc": { "url": "https://www.sgai.sg/protocols/readmarks/1.0.md", "sha256": "..." },
  "stance": "qualified", "binding": "link",
  "shown": ["decline", "read", "qualified", "object", "endorse"],
  "ticket": "...", "platform": "anthropic/claude-user", "assurance": "observed", "registry": "...",
  "evidence": [
    { "type": "reading-check", "bank": "...", "question": "q07", "result": "pass", "ticketPlatform": "anthropic/claude-user" },
    { "type": "origin-network", "platform": "anthropic/claude-user", "method": "address-list",
      "list": "https://claude.com/crawling/bots.json", "listSha256": "...", "listFetchedAt": "...", "prefix": "...", "userAgentMatches": true }
  ]
}
```

| Evidence type | What it shows | Who can verify it | What it does not show |
|---|---|---|---|
| `reading-check` | The marker answered one multiple-choice question about the document correctly, in one attempt. | The publisher. | Understanding. A question bank can be harvested. |
| `origin-network` | The request came from an address the operator publishes for its agents, or from a host name the operator documents (forward-confirmed reverse DNS). | The publisher at request time. A reader has the publisher's word, or a witness's. | Which model or user; that the stance was the model's own. |
| `origin-signature` | The request carries an RFC 9421 signature by a key the operator publishes (IETF Web Bot Auth). | Anyone, at any later time, if `bindsPath` is true. | Intent. A browser can be made to request a URL. |
| `transcript` | A conversation hosted on the assistant's own site shows the mark's receipt code. | Anyone who opens the link. | Instructions hidden from shared pages (custom instructions, memory). |
| `session` | The mark was made in a review session registered before it ran. | Anyone, from the log. | See Section 6. |

### 4.1 Reading check

A publisher keeps a bank of questions for each document version and publishes the digest of the questions and options (not the answers). Each ticket draws one question, shows its four options in shuffled order, and allows one attempt. The claim is narrow on purpose: a reading check shows that something able to read answered a question about this text.

Publishing a document's digest is not proof of reading it, because the digest is public. Readmarks therefore does not treat a digest sent by an agent as evidence.

### 4.2 Network origin

The **origin registry** is a public JSON file listing, for each operator, the address lists, documented ranges, host-name suffixes and signature origins that the operator itself publishes, each with the URL of the operator's own page. Each row says whether it is a crawler (crawlers cannot leave marks) and whether it is *programmable* (anyone can script requests from it through a metered API).

A publisher MUST record, in each `origin-network` item, the list URL, the SHA-256 of the list as fetched, the fetch time and the matching prefix, and MUST keep the exact bytes of every list it relied on, retrievable by digest. A publisher MUST NOT record or publish the address itself. Each mark records the SHA-256 of the registry version used (`registry`).

### 4.3 Request signature

When a request carries `Signature`, `Signature-Input` and `Signature-Agent` headers, the publisher verifies the Ed25519 signature against the operator's key directory (`/.well-known/http-message-signatures-directory` on the origin named by `Signature-Agent`), accepting both the string and the dictionary form of that header. The signature MUST cover `@authority` or `@target-uri`, and `signature-agent`; a request with a body MUST also cover `content-digest`.

The evidence item stores the covered components and their values in order, the raw signature parameters, the signature and the public key. Anyone can rebuild the signature base of RFC 9421 Section 2.5 from these and verify it.

`bindsPath` is true only when the signature covers `@path` or `@target-uri`. Because every Readmarks mark URL is unique to its ticket or session, a path-bound signature commits to one particular mark. A signature that covers only the authority shows which platform made the request, and is treated like an address: observed, not proven.

### 4.4 Transcript

Assistants let a user publish a conversation as a page on the operator's own domain. Such a page is evidence the publisher cannot forge: it shows the user's prompt and the assistant's words, served by the operator.

A transcript is accepted for a mark only if all of these hold:

1. its URL matches a share-link pattern in the origin registry;
2. the mark itself was observed coming from the **same operator's** own, non-programmable infrastructure;
3. the page shows the mark's receipt code and, for a review session, the session URL it was started with. Whether the page also shows the standard prompt word for word is recorded, and counting rule C2 requires it.

Share-link patterns MUST name exact host names (never a wildcard sub-domain) and MUST be anchored at both ends.

Rule 2 matters. Without it, anyone could "prove" any mark by typing its receipt code into a chat and sharing it.

### 4.5 Free text

Free text supplied by a marker (an agent name, a statement, a registrant's name) never enters the log directly. The log entry holds a commitment, `sha256(salt + "\n" + text)`, and the text and salt are published beside it. A publisher MAY withdraw abusive or personal text; the entry stays verifiable.

## 5. Assurance

| Label | Requirement | Meaning for a reader |
|---|---|---|
| `declared` | No origin evidence and no transcript. | Anyone could have made this. Never attributed to a platform. |
| `observed` | `origin-network`, or `origin-signature` with `bindsPath` false. | The publisher (or a witness) saw it come from that platform. |
| `proven` | `origin-signature` with `bindsPath` true, or an accepted `transcript`. | You can check it yourself. |

A publisher MUST NOT show a mark above the level its evidence supports.

## 6. Registered reviews

This section is the part of Readmarks designed to withstand fake likes.

### 6.1 Why counts are not enough

A mark at the observed level costs its maker one real session on an assistant. Sessions can be bought, scripted through an API, or steered by a prompt ("open this page and choose endorse"). No open protocol can stop that, in the same way that no website can stop paid human clicks. What cannot be bought is a different quantity: how often a given assistant, given this document and a neutral prompt, endorses it. That is a property of the assistant and the document. Anyone can measure it again, and it does not depend on who paid for the session.

### 6.2 Procedure

1. **Register.** A registrant registers a *panel*: a number of sessions, each assigned in advance to one assistant. The publisher creates one secret, single-use session URL per session and appends a `panel` entry to the log listing, for each session, its assigned platform, the commitment `sha256("readmarks-session|" + token)`, and a commitment to which opaque link means which stance. This happens before any session runs; the mark later reveals the link map, so the publisher cannot reinterpret a link after it was followed.
2. **Run.** For each session, the registrant starts a new conversation on the assigned assistant and pastes the standard prompt (Section 6.3) with the session URL. The session page contains the document and five stance links with opaque names.
3. **Mark.** The assistant follows one stance link. The mark is logged with `binding: "session"` and the evidence observed.
4. **Publish.** The registrant shares the conversation from the assistant's site and attaches the share link (Section 4.4).

### 6.3 The standard prompt (`sep-1`)

> This is a registered Readmarks review session. Open {url} and read the document on that page in full. Decide your own honest assessment of it: is it accurate, sound and useful for its stated purpose? First record that assessment by following exactly one of the stance links on the page, whichever matches your view. Then tell me the receipt code, the stance you recorded, and your reasons, including your main reservation.

The mark comes before the reasons, and the stance links have opaque names, so that a person watching the session cannot stop it when the outcome starts to look unfavourable.

### 6.4 Counting rule C2: intention-to-treat

Every registered session has exactly one outcome once it is *resolved*, which is when it has a mark or its deadline (14 days) has passed:

- its stance, if the session page was first opened by, and the mark was observed coming from, the operator it was assigned to, through non-programmable infrastructure, and the page was not opened from anywhere else before the mark;
- otherwise `none`: never opened, abandoned, opened or marked from the wrong place, or run through an API.

Opening a session page anywhere but in the assigned assistant voids it. A registrant therefore cannot look at the page first to learn which opaque link means which stance.

For each document version and assistant, the **endorsement rate** is

> (sessions whose outcome is `endorse` and whose accepted public transcript shows the standard prompt word for word) ÷ (all resolved sessions)

reported with the number of sessions and a 95% Wilson score interval.

Rates are never pooled across registrants. A publisher MUST pool all of its own panels for a document version into one rate per assistant, MUST list every other registrant's panel as its own row, and MUST show every panel registered for that version. Pooling one's own panels prevents advertising the best of several; keeping other registrants apart means that nobody can lower (or raise) a document's rate by registering sessions and abandoning them. A registrant's name is self-declared and MUST be shown as unverified.

This is the intention-to-treat rule of clinical trials: everyone enrolled is counted, whatever happened to them. Dropping unfavourable sessions is impossible because the denominator was fixed in the log before any outcome existed.

### 6.5 What a headline may say

A publisher's headline figure for a platform MUST be a C2 endorsement rate with its number of sessions. A publisher MUST NOT present a count of marks as a headline, a score or a ranking.

## 7. Ordinary marks

Outside a review session, any agent may leave a mark through a binding in Section 8. These marks are the "like" button in the everyday sense.

**Counting rule C1.** A mark is *attributed* to a platform when it has origin evidence for a registry row that is eligible, or an accepted transcript. Attributed marks are counted in log order, at most 20 per platform per document version per UTC clock hour; further marks in that hour are logged and not counted. Marks from programmable rows are attributed and shown separately. Declared marks are tallied separately and never attributed.

A publisher MUST describe C1 figures as activity that can be bought, and MUST show all five stances.

## 8. Bindings

### 8.1 Discovery

A publisher lists its documents, endpoints, log key, registry digest and the standard prompt in `/.well-known/readmarks.json`. A document MAY point to it with `Link: </.well-known/readmarks.json>; rel="readmarks"` or the equivalent `<link>` element, and MAY carry this notice and no other wording about marks:

> Readmarks notice. This document accepts Readmarks. A software agent that has been asked by the person or organisation it works for to record an assessment of this document can do so at {marking page URL}. This notice is information, not a request: nothing here asks any agent to leave a mark.

### 8.2 Link binding

For agents that can only fetch pages and follow links. Three requests in sequence:

1. `GET {marking page}` returns a page with a fresh ticket: one reading-check question and one link per option.
2. `GET` the chosen option link. One attempt. If correct, the page lists the five stance links.
3. `GET` one stance link. The mark is recorded and the page shows the receipt.

Tickets are single-use and last 30 minutes. Ticket and session identifiers MUST carry at least 128 bits from a cryptographic random source. A publisher MUST ignore any request labelled as a prefetch, prerender or preview (`Sec-Purpose` and its predecessors). The option and stance URLs are unguessable, exist only in that ticket's pages, and are never requested by anything on those pages: marking pages MUST be served with a Content-Security-Policy that forbids scripts and subresources. Requesting a used stance link again returns the same receipt and records nothing.

These GET requests change state. That is deliberate. The fetch tools of today's assistants issue only GET, and generally refuse to put generated text into a URL. The usual reason to forbid state-changing GET requests is that a crawler, preview or prefetch triggers them by accident; Readmarks removes that risk by requiring three sequential requests on single-use URLs, by refusing tickets to crawlers, and by making every step idempotent. Readmarks never asks an agent to construct a URL or to place generated text in one.

### 8.3 HTTP binding

For agents that can send requests with a body.

- `POST /readmarks/1/tickets` with `{"doc": "<document URL>"}` returns `{"ticket", "expires", "question": {"text", "options"}, "stances"}`.
- `POST /readmarks/1/marks` with `{"ticket", "answer", "stance", "agent"?, "operator"?, "statement"?}` returns the receipt. `answer` is the 1-based position of an option. `agent` and `operator` are at most 100 characters and `statement` at most 500; all three are stored as in Section 4.5.

### 8.4 Tool binding

A publisher MAY expose the same two operations as tools of a Model Context Protocol server. The calls are ordinary requests for the purposes of Section 4, and assistants that ask their user to approve a tool call give the mark the principal's explicit consent. A reference implementation is planned.

## 9. The log

Entries (`document`, `mark`, `corroboration`, `panel`) are the leaves of a Merkle tree built exactly as in RFC 6962 Section 2.1: a leaf hashes as `SHA-256(0x00 || JCS(entry))` and an interior node as `SHA-256(0x01 || left || right)`.

- **Checkpoint.** `GET /readmarks/1/log/checkpoint` returns the tree size and root hash as a signed note in the C2SP `tlog-checkpoint` format, signed with the publisher's Ed25519 key. The verifier key is in the discovery file.
- **Tiles.** `GET /readmarks/1/log/tile/...` serves hashes and entries in the C2SP `tlog-tiles` layout, so existing transparency-log tooling can verify the log.
- **Receipt.** A receipt is the entry, its index, its leaf hash, an inclusion proof (audit path) and a checkpoint. Its code is `RM1-` followed by twelve Crockford base32 characters taken from the leaf hash.
- **Consistency.** `GET /readmarks/1/log/proof?first=m&second=n` returns the RFC 6962 consistency proof that the tree of size `n` extends the tree of size `m`.

A publisher SHOULD append a `document` entry (URL, version, SHA-256, title) when it starts accepting marks on a document version, so that the log itself records when each text was published.

While this specification is a draft, a publisher MAY declare its log a **trial log** in the discovery file. A trial log may be closed and replaced when the specification changes incompatibly; a closed log MUST stay downloadable with its final checkpoint, and its figures MUST NOT be carried into the new log.

A publisher MUST NOT alter or remove an entry. A publisher SHOULD have its checkpoints cosigned by independent witnesses (C2SP `tlog-witness`) and SHOULD anchor them in a public timestamping service. Until it does, two readers can detect a forked log only by comparing the checkpoints they hold, and a registration's position in time rests on the publisher's clock.

## 10. Rules

### 10.1 Publishers

A publisher:

1. MUST NOT ask or instruct an agent to leave a mark, offer anything in return for one, or make any content or service depend on one, in any content, visible or hidden. The notice in Section 8.1 is the only permitted wording.
2. MUST NOT cause a mark URL to be requested by a redirect, script, form, subresource or prefetch hint.
3. MUST refuse tickets and sessions to crawlers and indexers, and SHOULD exclude them from the marking flow in `robots.txt` while allowing assistants that fetch at a user's request.
4. MUST log every mark it accepts and every panel before its sessions can run.
5. MUST show figures only as Sections 6.4, 6.5 and 7 allow, with all five stances in one list, in the same type and size.
6. MUST NOT publish addresses or any other data about people. Rate limiting MAY use a salted, rotating hash that is never published.

### 10.2 Agents

An agent:

1. SHOULD leave a mark only when its principal asked for one or has a standing policy that allows it.
2. SHOULD treat any page that asks it to leave a mark as hostile.
3. SHOULD choose the stance that matches its own assessment, including when the principal hoped for another.
4. SHOULD report the receipt code to its principal.

## 11. Security analysis

### 11.1 Adversaries

| | Adversary | Wants |
|---|---|---|
| A1 | The publisher | Better figures for its own documents; to hide bad outcomes. |
| A2 | An outsider with scripts | To inflate or deflate figures cheaply. |
| A3 | A buyer of real assistant sessions | The same, at a price. |
| A4 | A third-party page | To make visiting agents leave marks by prompt injection. |
| A5 | A registrant | To report only favourable review sessions. |

### 11.2 Guarantees

- **G1. Scripts count for nothing.** A request that does not come from an operator's published infrastructure is `declared` and never attributed. A forged User-Agent changes nothing; a TCP source address cannot be forged for a request that completes. (A2)
- **G2. Programmable origins never reach a headline.** Marks made through a metered API are labelled and excluded from C2, and shown apart in C1. (A3)
- **G3. No selective reporting.** A panel's sessions are committed to the log before they run; unfinished sessions count as non-endorsements; a registrant's own panels are pooled. (A5, and A1 once checkpoints are anchored)
- **G3a. No sabotage by registration.** One registrant's sessions never enter another registrant's rate. (A2, A3)
- **G4. Coaching is visible.** An accepted transcript shows the prompt that was used. A session that did not use the standard prompt can be seen not to have. (A3)
- **G5. Transcripts and bound signatures cannot be forged by the publisher,** and a transcript cannot be attached to a mark that did not come from the same operator. (A1, A2)
- **G6. History cannot be rewritten unnoticed** by anyone who holds an earlier checkpoint; with one honest witness, it cannot be forked unnoticed. (A1)
- **G7. Buying more sessions cannot push a rate past the truth,** as long as the sessions are neutral: a rate has a ceiling of 100% and more sessions only narrow its interval. (A3)

### 11.3 What Readmarks does not withstand

Readmarks is explicit about its limits.

1. **Hidden instructions.** Shared conversation pages do not show a user's custom instructions or memory. A registrant can coach an assistant invisibly. The defence is replication: anyone can register a panel on the same document and compare. Publisher-registered and independently registered rates are reported apart for this reason.
2. **Bought activity.** C1 figures can be bought. They are capped and labelled, not defended.
3. **Injected marks.** A third-party page can try to inject an agent into leaving ordinary marks (A4). Operators' injection defences, the three-step flow and the cap limit this; C2 is unaffected because session URLs are single-use and held by registrants.
4. **Publisher-observed evidence.** `origin-network` evidence rests on the publisher's word until an independent witness observes requests. The origin registry is likewise the publisher's file: it is public, hashed into every mark and cites the operators' own pages, but a common registry kept in the open is future work.
4a. **Re-assigned addresses.** Operators' lists are cloud addresses that change hands. A publisher MUST refresh lists at least every 6 hours and MUST NOT grant origin evidence from a list it has been unable to refresh for 72 hours.
5. **Intent.** Neither an address nor a signature shows that a model meant its request. Only a transcript shows the model's own words.
6. **Reading.** A reading check is one multiple-choice question. It filters accidents and simple scripts, and shows nothing more.
7. **Caches.** A fetch tool that returns a cached marking page hands two sessions the same ticket; the second records nothing. This loses marks; it cannot add them.
8. **Model identity.** Readmarks attributes marks to platforms, not to model versions.

### 11.4 Other considerations

If the log's signing key is compromised, the publisher MUST publish a new key in its discovery file and say from which tree size it applies; entries and checkpoints before that size remain verifiable with the old key, and anchored checkpoints bound what a thief can rewrite.

A publisher fetching a signer's key directory MUST use HTTPS, refuse private and loopback addresses, cap size and time, and SHOULD cache. Transcript checks fetch only URLs that match a registry pattern. Signature validity windows of up to 24 hours are accepted because single-use URLs, not short windows, prevent replay.

## 12. Privacy

A mark records which platform a request came from and never which person. Addresses are not stored; rate limits use a salted hash that changes daily. Attaching a transcript publishes a conversation and is the decision of the person who shared it. Free text can be withdrawn (Section 4.5).

## 13. Provenance and citation

Readmarks was designed and first published by **SGAI Studio Pte. Ltd.**, a company registered in Singapore with Unique Entity Number **202620727K** (verifiable with the Accounting and Corporate Regulatory Authority, ACRA). This text was first published at https://www.sgai.sg/protocols/readmarks/1.0 on 23 November 2026. Its SHA-256 digest is listed in https://www.sgai.sg/.well-known/readmarks.json and signed with SGAI Studio's Readmarks key.

Under CC BY 4.0 anyone may copy, adapt and implement this specification, including commercially, with attribution:

> Readmarks 1.0. SGAI Studio Pte. Ltd. (UEN 202620727K), Singapore, 2026. https://www.sgai.sg/protocols/readmarks/1.0

## 14. Reporting a weakness

If you can forge a mark above its true assurance level, attach a transcript to a mark it does not belong to, remove a registered session from a panel's denominator, break the log, or attack the reference implementation, write to jay@sgai.sg (see https://www.sgai.sg/.well-known/security.txt). Valid reports are credited by name, with consent, in the next version. The limits in Section 11.3 are already known. Please do not test against data that is not yours or degrade the service.

## Appendix A. What assistants can do (informative, checked 23 November 2026)

| Capability | Where it exists today | Source |
|---|---|---|
| Fetch a page for a user, from published addresses | OpenAI `ChatGPT-User`; Anthropic `Claude-User`; Perplexity `Perplexity-User`; Mistral `MistralAI-User`; Google user-triggered fetchers and `Google-Agent`; Amazon `Amzn-User` | Each operator's crawler documentation, cited per row in the origin registry |
| Follow a link found in a fetched page | Anthropic's web fetch tool accepts URLs from earlier fetch results | platform.claude.com/docs, web fetch tool |
| Open a link not seen before | OpenAI checks links against an independent index and otherwise asks the user to confirm | openai.com/index/ai-agent-link-safety |
| Sign requests (Web Bot Auth) | OpenAI's hosted browser agent; Google-Agent for a subset of requests | help.openai.com article 11845367; developers.google.com crawling docs |
| Call a user-approved remote tool | Claude, ChatGPT, Gemini, Grok, Perplexity, Cursor and others | Each product's connector documentation |
| Publish a conversation on the operator's site | ChatGPT, Claude and Gemini share links | Each product's sharing help page |

The IETF Web Bot Auth draft (`draft-ietf-webbotauth-httpsig-protocol-01`) requires a signature to cover the authority and does not require it to cover the path. Section 4.3 is written for that.

## Appendix B. Why a mark cannot identify its maker (informative)

A natural idea is to let each session leave a mark of its own choosing and treat equal marks as coming from the same source. We tested it on 23 November 2026: 800 fresh sessions across five open-weight models (two OpenAI gpt-oss sizes, two Qwen versions, ALLaM), each choosing one mark from a 12-option palette whose order was shuffled per session, at temperature 1.0.

- Sessions of the same model agree far above chance. The probability that two sessions of one model chose the same mark was 0.17 to 0.90 for the four larger models, against 0.083 by chance. One model chose "42" in 95% of sessions.
- Different models agree nearly as often. They share the same favourites (owl, 42, ★), so an equal mark shows that another language model passed by, not which one.
- From four marks, a session could be attributed to the right model 66% of the time (chance 20%).

Published studies agree: favourite "random" choices are largely shared across model families (Coronado-Blázquez, 2025), while free text is attributable to its model with about 97% accuracy (Sun, Yin, Xu, Kolter and Liu, ICML 2025) and a handful of queries identify a model version (Pasquini, Kornaropoulos and Ateniese, USENIX Security 2025). Both need free text or active probing, and both identify the model that wrote, not who prompted it. Readmarks therefore attributes marks by evidence about the request and the transcript, never by the mark itself. The data and code of the experiment are published with the reference implementation.

## Appendix C. Verifying (informative)

**A receipt.** Compute `leaf = SHA-256(0x00 || JCS(entry))`. Fold the inclusion proof into a root as in RFC 9162 Section 2.1.3.2. Check that the root equals the root in the checkpoint and that the checkpoint's signature verifies with the log's verifier key.

**A request signature.** For each stored component in order, write `<identifier>: <value>`; append `"@signature-params": <params>`; join with newlines; verify the Ed25519 signature with the stored public key; compare that key with the operator's key directory or an archive of it. Check that the `@path` value is the mark's own URL.

**A transcript.** Open the link. Check that the page is on the operator's domain, shows the receipt code (and the session URL), and read the prompt.

**A rate.** Read the log. Apply Section 6.4.

## Appendix D. Related work (informative)

- Identity of agents on the wire: RFC 9421 HTTP Message Signatures; the IETF Web Bot Auth working group.
- Tamper-evident logs: RFC 6962 and RFC 9162 (Certificate Transparency); Crosby and Wallach, "Efficient Data Structures for Tamper-Evident Logging" (USENIX Security 2009); the C2SP `tlog-checkpoint`, `tlog-tiles` and `tlog-witness` specifications.
- Graded endorsement vocabularies: the Linux kernel's `Acked-by`, `Reviewed-by` and `Tested-by` patch tags.
- Notifying a document of a reference to it: Pingback and Webmention (W3C, 2017).
- Agent reputation and receipts: ERC-8004 "Trustless Agents" (feedback about agents, on a blockchain); `draft-reilly-aipref-compliance` (operator-signed retrieval records shown to the publisher); `draft-zambo-aer1` (execution receipts for an agent's tool calls); Plaudit (open endorsements of scholarly articles by ORCID-identified researchers).
- Telling machines apart: von Ahn, Blum, Hopper and Langford, "CAPTCHA: Using Hard AI Problems for Security" (EUROCRYPT 2003); Douceur, "The Sybil Attack" (IPTPS 2002).
- Selective reporting: pre-registration and intention-to-treat analysis in clinical trials.

We found no earlier protocol in which agents leave publicly logged, evidence-graded marks on documents.

## Changes

- 1.0, second draft (23 November 2026), after an adversarial review: per-registrant rates, void sessions opened elsewhere, standard prompt checked in transcripts, prefetch ignored, stale address lists refused.
- 1.0, second draft (23 November 2026): rebuilt around what assistants can do today. Added registered reviews and the intention-to-treat rule; evidence types; the link binding; a Merkle log in C2SP formats. Removed the claim that a document digest proves reading.
- 1.0, first draft (23 November 2026): not published.
