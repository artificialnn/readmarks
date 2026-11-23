#!/usr/bin/env python3
"""readmarks-verify: an independent auditor for a Readmarks 1.0 log. Written from the specification, sharing no code with the server.

  python3 readmarks-verify.py https://www.sgai.sg            # verify everything public
  python3 readmarks-verify.py http://localhost:3911 --quiet

Checks, using public endpoints only:
  1. the checkpoint's Ed25519 signature and key ID (C2SP signed note) against the verifier key in the discovery file;
  2. the Merkle root (RFC 6962), recomputed from every entry fetched through the tlog-tiles entry bundles;
  3. the level-0 hash tiles against the recomputed leaf hashes;
  4. each receipt's inclusion proof (RFC 9162 2.1.3.2) and a consistency proof between two sizes (2.1.4.2);
  5. every origin-signature: the RFC 9421 signature base is rebuilt from the stored components and verified, and a
     path-bound signature must be for that mark's own URL (ticket or session commitment, and the stance);
  6. every review session: its commitment and link map must match the panel entry registered BEFORE it;
  7. every free-text commitment that is still published;
  8. counting rule C2 (intention-to-treat), recomputed and compared with the publisher's figures.
Needs: Python 3.9+, `cryptography`. MIT licence. SGAI Studio Pte. Ltd. (UEN 202620727K).
"""
import base64, hashlib, json, sys, urllib.request, urllib.parse, math, datetime
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

BASE = sys.argv[1].rstrip('/')
QUIET = '--quiet' in sys.argv
NOW = None
for a in sys.argv:
    if a.startswith('--now='): NOW = int(a[6:])
fails = []
def ok(cond, name, detail=''):
    if not cond: fails.append(name)
    if not QUIET or not cond: print(('PASS ' if cond else 'FAIL ') + name + (f'  {detail}' if detail else ''))
def get(path, raw=False):
    r = urllib.request.urlopen(urllib.request.Request(BASE + path, headers={'User-Agent': 'readmarks-verify/1.0'}), timeout=30)
    b = r.read()
    return b if raw else json.loads(b)
H = lambda b: hashlib.sha256(b).digest()
def jcs(v):
    if v is None: return 'null'
    if v is True: return 'true'
    if v is False: return 'false'
    if isinstance(v, int): return str(v)
    if isinstance(v, str): return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list): return '[' + ','.join(jcs(x) for x in v) + ']'
    if isinstance(v, dict): return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + jcs(v[k]) for k in sorted(v, key=lambda s: s.encode('utf-16-be'))) + '}'
    raise ValueError('not a Readmarks value')
def mth(leaves):                       # RFC 6962 2.1, over leaf HASHES
    n = len(leaves)
    if n == 0: return H(b'')
    if n == 1: return leaves[0]
    k = 1
    while k * 2 < n: k *= 2
    return H(b'\x01' + mth(leaves[:k]) + mth(leaves[k:]))
def root_from_inclusion(leaf, index, size, proof):   # RFC 9162 2.1.3.2
    fn, sn, r = index, size - 1, leaf
    for p in proof:
        if sn == 0: return None
        if fn % 2 == 1 or fn == sn:
            r = H(b'\x01' + p + r)
            if fn % 2 == 0:
                while fn % 2 == 0 and fn != 0: fn >>= 1; sn >>= 1
        else:
            r = H(b'\x01' + r + p)
        fn >>= 1; sn >>= 1
    return r if sn == 0 else None
def consistent(m, n, first, second, proof):          # RFC 9162 2.1.4.2
    if m == n: return not proof and first == second
    path = list(proof)
    if m & (m - 1) == 0: path = [first] + path
    fn, sn = m - 1, n - 1
    while fn % 2 == 1: fn >>= 1; sn >>= 1
    if not path: return False
    fr = sr = path[0]
    for c in path[1:]:
        if sn == 0: return False
        if fn % 2 == 1 or fn == sn:
            fr = H(b'\x01' + c + fr); sr = H(b'\x01' + c + sr)
            if fn % 2 == 0:
                while fn % 2 == 0 and fn != 0: fn >>= 1; sn >>= 1
        else:
            sr = H(b'\x01' + sr + c)
        fn >>= 1; sn >>= 1
    return sn == 0 and fr == first and sr == second
def tile_path(n, width):
    parts = []
    while True:
        parts.append(n % 1000); n //= 1000
        if n == 0: break
    parts.reverse()
    s = '/'.join(('x%03d' % p) if i < len(parts) - 1 else ('%03d' % p) for i, p in enumerate(parts))
    return s + ('' if width == 256 else f'.p/{width}')
def wilson(k, n):
    if n <= 0: return None
    z = 1.959964; p = k / n; d = 1 + z * z / n
    c = p + z * z / (2 * n); w = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [max(0, (c - w) / d), min(1, (c + w) / d)]

# 1. discovery and checkpoint
disc = get('/.well-known/readmarks.json')
name, khash, kb64 = disc['log']['vkey'].split('+', 2)   # the base64 part may itself contain '+'
kraw = base64.b64decode(kb64)
ok(kraw[0] == 1 and len(kraw) == 33, 'verifier key is Ed25519')
pub = kraw[1:]
ok(H(name.encode() + b'\n\x01' + pub)[:4].hex() == khash, 'verifier key ID matches its name and key')
note = get('/readmarks/1/log/checkpoint', raw=True).decode()
body, sigs = note.split('\n\n', 1)
body += '\n'
origin, size_s, root_b64 = body.split('\n')[:3]
size = int(size_s); root = base64.b64decode(root_b64)
ok(origin == disc['log']['origin'], 'checkpoint origin', origin)
good = False
for line in sigs.strip().split('\n'):
    dash, kn, sb = line.split(' ', 2)
    raw = base64.b64decode(sb)
    if dash == '—' and kn == name and raw[:4].hex() == khash:
        try: Ed25519PublicKey.from_public_bytes(pub).verify(raw[4:], body.encode()); good = True
        except Exception: pass
ok(good, 'checkpoint signature verifies', f'size {size} root {root.hex()[:16]}…')

# 2. every entry, through the tiles; recompute the root
entries = []
for t in range((size + 255) // 256):
    w = min(256, size - t * 256)
    b = get('/readmarks/1/log/tile/entries/' + tile_path(t, w), raw=True)
    i = 0
    while i < len(b):
        ln = int.from_bytes(b[i:i + 2], 'big'); entries.append(b[i + 2:i + 2 + ln]); i += 2 + ln
ok(len(entries) == size, 'entry bundles hold every entry', f'{len(entries)} of {size}')
leaves = [H(b'\x00' + e) for e in entries]
ok(mth(leaves) == root, 'Merkle root recomputed from the entries equals the signed root')
parsed = [json.loads(e) for e in entries]
ok(all(jcs(p).encode() == e for p, e in zip(parsed, entries)), 'every entry is in canonical form (JCS)')

# 3. hash tiles
tile_ok = True
for t in range((size + 255) // 256):
    w = min(256, size - t * 256)
    b = get('/readmarks/1/log/tile/0/' + tile_path(t, w), raw=True)
    tile_ok &= b == b''.join(leaves[t * 256:t * 256 + w])
ok(tile_ok, 'level-0 hash tiles equal the recomputed leaf hashes')

# 4. proofs
if size:
    js = get('/readmarks/1/log/entries?from=0&limit=500')
    for idx in sorted(set([0, size // 2, size - 1])):
        r = get(f'/readmarks/1/r/{idx}/json')
        rr = root_from_inclusion(bytes.fromhex(r['leafHash']), r['index'], r['treeSize'], [bytes.fromhex(x) for x in r['inclusionProof']])
        ok(bytes.fromhex(r['leafHash']) == leaves[idx] and rr is not None and (rr == root if r['treeSize'] == size else True), f'inclusion proof for entry {idx}')
    if size >= 2:
        m = max(1, size // 2)
        c = get(f'/readmarks/1/log/proof?first={m}&second={size}')
        ok(consistent(m, size, mth(leaves[:m]), root, [bytes.fromhex(x) for x in c['proof']]), f'consistency proof {m} -> {size} (the log only grew)')
        ok(not consistent(m, size, H(b'another history'), root, [bytes.fromhex(x) for x in c['proof']]), 'a rewritten history fails the consistency proof')

# 5-7. evidence
panels = {}
sig_n = bound_n = sess_n = text_n = 0
bad = []
texts = {}
for start in range(0, size, 500):
    for x in get(f'/readmarks/1/log/entries?from={start}&limit=500')['entries']:
        if 'text' in x: texts[x['index']] = x['text']
for i, e in enumerate(parsed):
    if e['type'] == 'panel':
        for s in e['sessions']: panels[s['commitment']] = (i, e, s)
    for k, cm in (e.get('claims') or {}).items():
        t = texts.get(i, {}).get(k)
        if t:
            text_n += 1
            if hashlib.sha256((t['salt'] + '\n' + t['text']).encode()).hexdigest() != cm: bad.append(f'entry {i}: commitment {k}')
    if e['type'] != 'mark': continue
    for ev in e['evidence']:
        if ev['type'] == 'origin-signature':
            sig_n += 1
            base = '\n'.join([f'{c}: {v}' for c, v in ev['components']] + [f'"@signature-params": {ev["params"]}'])
            try:
                Ed25519PublicKey.from_public_bytes(base64.urlsafe_b64decode(ev['jwk']['x'] + '==')).verify(base64.b64decode(ev['signature']), base.encode())
            except Exception:
                bad.append(f'entry {i}: signature does not verify'); continue
            comp = dict(ev['components'])
            path = comp.get('"@path"') or urllib.parse.urlparse(comp.get('"@target-uri"', '')).path
            claims_bound = bool(path)
            if claims_bound != bool(ev['bindsPath']): bad.append(f'entry {i}: bindsPath flag is wrong')
            if e['assurance'] == 'proven' and not claims_bound: bad.append(f'entry {i}: labelled proven without a path-bound signature')
            if claims_bound and path.startswith('/readmarks/1/'):   # the body-carrying bindings sign a fixed path; only link URLs name the mark
                bound_n += 1
                parts = path.strip('/').split('/')
                if e['binding'] == 'link':
                    good_path = len(parts) == 6 and parts[2] == 'k' and parts[4] == 's' and hashlib.sha256(('readmarks-ticket|' + parts[3]).encode()).hexdigest() == e['ticket'] and parts[5] == e['stance']
                elif e['binding'] == 'session':
                    sev = next(v for v in e['evidence'] if v['type'] == 'session')
                    good_path = len(parts) == 6 and parts[2] == 'e' and parts[4] == 's' and hashlib.sha256(('readmarks-session|' + parts[3]).encode()).hexdigest() == e['session'] and sev['links'].get(parts[5]) == e['stance']
                else:
                    good_path = path == '/readmarks/1/marks'
                if not good_path: bad.append(f'entry {i}: the signed path is not this mark')
        if ev['type'] == 'session':
            sess_n += 1
            reg = panels.get(ev['commitment'])
            if not reg or reg[0] >= i: bad.append(f'entry {i}: session was not registered before its mark'); continue
            lc = hashlib.sha256((ev['linksSalt'] + '\n' + json.dumps(dict(sorted(ev['links'].items())), separators=(',', ':'))).encode()).hexdigest()
            if lc != reg[2]['links'] or ev['links'].get(ev['link']) != e['stance'] or ev['assignedPlatform'] != reg[2]['platform']:
                bad.append(f'entry {i}: session link map or platform differs from its registration')
    if e['assurance'] == 'proven' and not any(v['type'] == 'origin-signature' and v['bindsPath'] for v in e['evidence']): bad.append(f'entry {i}: proven without proof')
    if e['assurance'] == 'observed' and not any(v['type'] in ('origin-network', 'origin-signature') for v in e['evidence']): bad.append(f'entry {i}: observed without origin evidence')
    if e['assurance'] == 'declared' and e.get('platform'): bad.append(f'entry {i}: declared but attributed')
ok(not bad, f'evidence: {sig_n} request signatures re-verified ({bound_n} bound to their mark URL), {sess_n} review sessions matched to earlier registrations, {text_n} text commitments', '; '.join(bad[:5]))

# 8. counting rule C2, recomputed
reg = get('/readmarks/1/origins')
op = {o['id']: o for o in reg['origins']}
top = {t['platform']: t['operator'] for t in reg['transcripts']}
operator = lambda p: (op.get(p) or {}).get('operator') or top.get(p)
now_ms = NOW or int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
tr = {}
first_mark = {}
for i, e in enumerate(parsed):
    if e['type'] == 'corroboration':
        for ev in e['evidence']:
            if ev['type'] == 'transcript' and ev.get('standardPromptShown') is True: tr.setdefault(e['mark'], []).append(ev['platform'])
    if e['type'] == 'mark' and e['binding'] == 'session': first_mark.setdefault(e['session'], (i, e))
from_assigned = lambda p, assigned: bool(p) and not (op.get(p) or {}).get('programmable') and operator(p) is not None and operator(p) == operator(assigned)
rows = {}
for i, e in enumerate(parsed):
    if e['type'] != 'panel': continue
    group = None if e.get('registeredBy') == 'publisher' else e['panel']     # the publisher's panels pooled; every other panel alone
    t0 = datetime.datetime.fromisoformat(e['time'].replace('Z', '+00:00')).timestamp() * 1000
    deadline = t0 + e.get('deadlineDays', 14) * 86400000
    for s in e['sessions']:
        r = rows.setdefault((e['doc']['sha256'], s['platform'], group), {'registered': 0, 'resolved': 0, 'k': 0})
        r['registered'] += 1
        m = first_mark.get(s['commitment'])
        if not m:
            if now_ms >= deadline: r['resolved'] += 1
            continue
        r['resolved'] += 1
        mi, me = m
        sev = next(v for v in me['evidence'] if v['type'] == 'session')
        valid = (me['assurance'] != 'declared' and from_assigned(me.get('platform'), s['platform'])
                 and from_assigned(sev.get('openedFrom'), s['platform']) and sev.get('foreignOpensBeforeMark', 0) == 0)
        has_t = any(operator(p) == operator(s['platform']) for p in tr.get(leaves[mi].hex(), []))
        if valid and has_t and me['stance'] == 'endorse': r['k'] += 1
st = get('/readmarks/1/stats' + (f'?now={NOW}' if NOW else ''))
mism = []
for d in st['documents']:
    for r in d['reviews']:
        mine = rows.get((d['sha256'], r['platform'], r['panel']))
        if not mine or mine['registered'] != r['registered'] or mine['resolved'] != r['resolved'] or mine['k'] != r['endorsedWithTranscript']:
            mism.append(f"{r['platform']}/{r['panel']}: publisher says {r['endorsedWithTranscript']}/{r['resolved']}, log says {mine}")
        elif r['resolved'] and (abs(r['rate'] - mine['k'] / mine['resolved']) > 1e-9 or max(abs(a - b) for a, b in zip(r['interval'], wilson(mine['k'], mine['resolved']))) > 1e-6):
            mism.append(f"{r['platform']}: rate or interval differs")
n_rows = sum(len(d['reviews']) for d in st['documents'])
ok(not mism and n_rows == len(rows), f'counting rule C2 recomputed from the log matches the published figures ({n_rows} rows)', '; '.join(mism[:3]))

print(('\nALL CHECKS PASSED' if not fails else f'\n{len(fails)} CHECK(S) FAILED: ' + '; '.join(fails)) + f'  ({size} entries)')
sys.exit(1 if fails else 0)
