# Tests

- `merkle-vectors.mts`: the Certificate Transparency reference vectors for RFC 6962, plus proof round-trips (`npx tsx tests/merkle-vectors.mts`).
- `attack.mjs`: 37 end-to-end checks against a development server with a throwaway database. Each "ATTACK" asserts that a fake like does not get the credit its maker wants: forged user agents, crawlers, API-bought sessions, transcript tricks, forged and replayed signatures, selective reporting, sabotage by registration, prefetch, floods.
- `setup.mjs`: makes the throwaway signing key and key directories the attack suite uses.

The attack suite needs the publisher's question bank with answers (`READMARKS_BANK=/path/to/bank.json`), which is not published. Never run it against a live log: a log is append-only.
