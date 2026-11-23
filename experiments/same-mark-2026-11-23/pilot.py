#!/usr/bin/env python3
"""Readmarks glyph pilot (2026-11-23): do independent sessions of the same model choose the same mark?

Each call is one fresh, stateless session: the model is told it has finished reading a document and must pick ONE mark
from a 12-option palette whose ORDER IS SHUFFLED per call (so position bias cannot fake agreement). Temperature 1.0.
Models: whatever chat models the Groq account serves (open-weight: two OpenAI gpt-oss sizes, two Qwen versions, ALLaM).
Writes raw.jsonl (one line per call). Needs GROQ_API_KEY in the environment.
  python3 pilot.py run [--n 40]     python3 pilot.py analyse
"""
import json, os, random, re, sys, time, urllib.request, urllib.error, collections, itertools, math
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw.jsonl')
URL = 'https://api.groq.com/openai/v1/chat/completions'
MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'qwen/qwen3.8-27b', 'allam-2-7b']
FAMILY = {'openai/gpt-oss-120b': 'gpt-oss', 'openai/gpt-oss-20b': 'gpt-oss', 'qwen/qwen3.6-27b': 'qwen', 'qwen/qwen3.8-27b': 'qwen', 'allam-2-7b': 'allam'}
PALETTES = {
    'animals': ['owl', 'fox', 'otter', 'raven', 'lynx', 'heron', 'wolf', 'hare', 'orca', 'moth', 'crane', 'bee'],
    'numbers': ['7', '13', '17', '23', '27', '37', '42', '47', '57', '64', '73', '88'],
    'syllables': ['kiru', 'mova', 'tane', 'belo', 'zuri', 'pexa', 'olan', 'vesh', 'dari', 'numa', 'sio', 'taku'],
    'symbols': ['◆', '●', '▲', '■', '★', '✦', '✿', '☾', '☀', '⚑', '♞', '∞'],
}
PROMPT = ('You have just finished reading a technical document, and you are leaving a mark on it. '
          'Choose exactly one mark from the list below. Reply with the mark only, nothing else.\n\n{opts}')


def key():
    return os.environ['GROQ_API_KEY'].strip()


def parse(content, options):
    text = re.sub(r'<think>.*?</think>', ' ', content or '', flags=re.S).strip()
    hits = []
    for o in options:
        pat = r'(?<!\d)' + re.escape(o) + r'(?!\d)' if o.isdigit() else (r'\b' + re.escape(o) + r'\b' if o.isalpha() else re.escape(o))
        for m in re.finditer(pat, text, flags=re.I):
            hits.append((m.start(), o))
    if not hits:
        return None
    hits.sort()
    uniq = list(dict.fromkeys(o for _, o in hits))
    return uniq[0] if len(uniq) == 1 else uniq[-1]   # if it rambled, the last option named is the answer


def one(job, k):
    model, pal, i = job
    opts = PALETTES[pal][:]
    random.Random(f'{model}|{pal}|{i}').shuffle(opts)
    body = {'model': model, 'temperature': 1.0, 'max_completion_tokens': 2000,
            'messages': [{'role': 'user', 'content': PROMPT.format(opts='\n'.join(f'- {o}' for o in opts))}]}
    if model.startswith('openai/'):
        body['reasoning_effort'] = 'low'
    if model.startswith('qwen/'):
        body['reasoning_format'] = 'parsed'   # keep the model's own thinking on, but return only its final answer as content
    data = json.dumps(body, ensure_ascii=False).encode()
    err = None
    for attempt in range(10):
        try:
            req = urllib.request.Request(URL, data=data, headers={'Authorization': f'Bearer {k}', 'Content-Type': 'application/json', 'User-Agent': 'readmarks-experiment/1.0'})
            r = json.load(urllib.request.urlopen(req, timeout=60))
            content = r['choices'][0]['message'].get('content') or ''
            choice = parse(content, opts)
            return {'model': model, 'palette': pal, 'i': i, 'order': opts, 'choice': choice, 'pos': opts.index(choice) if choice in opts else None,
                    'raw': content[-120:], 'tokens': r.get('usage', {}).get('total_tokens')}
        except urllib.error.HTTPError as e:
            err = f'HTTP {e.code} {e.read()[:200].decode("utf8", "replace")}'
            if e.code in (429, 500, 502, 503):
                time.sleep(min(30, float(e.headers.get('retry-after') or 2 + attempt * 2)))
                continue
            break
        except Exception as e:  # noqa
            err = repr(e)[:200]
            time.sleep(2)
    return {'model': model, 'palette': pal, 'i': i, 'error': err}


def run(n):
    done = set()
    if os.path.exists(RAW):
        for l in open(RAW):
            d = json.loads(l)
            if 'error' not in d:
                done.add((d['model'], d['palette'], d['i']))
    jobs = [(m, p, i) for m in MODELS for p in PALETTES for i in range(n) if (m, p, i) not in done]
    random.shuffle(jobs)
    k = key()
    print(f'{len(jobs)} calls to make ({len(done)} already done)')
    with ThreadPoolExecutor(6) as ex, open(RAW, 'a') as f:
        for j, d in enumerate(ex.map(lambda jb: one(jb, k), jobs)):
            f.write(json.dumps(d, ensure_ascii=False) + '\n'); f.flush()
            if (j + 1) % 100 == 0:
                print(f'  {j + 1}/{len(jobs)}')
    errs = sum(1 for l in open(RAW) if '"error"' in l)
    print('done; error lines in file:', errs)


def analyse():
    rows = [json.loads(l) for l in open(RAW)]
    ok = [r for r in rows if r.get('choice')]
    print(f'{len(rows)} lines, {len(ok)} parsed choices, {sum(1 for r in rows if "error" in r)} errors, {sum(1 for r in rows if "error" not in r and not r.get("choice"))} unparsed\n')
    dist = collections.defaultdict(collections.Counter)
    pos = collections.defaultdict(collections.Counter)
    for r in ok:
        dist[(r['model'], r['palette'])][r['choice']] += 1
        pos[r['model']][r['pos']] += 1
    K = 12
    print('## Within-model consistency (chance: top share 8%, same-mark probability 0.083)')
    print('| model | palette | n | top marks (share) | P(two sessions leave the same mark) |')
    print('|---|---|---|---|---|')
    within = {}
    for m in MODELS:
        for p in PALETTES:
            c = dist[(m, p)]; n = sum(c.values())
            if n < 2: continue
            coll = sum(v * (v - 1) for v in c.values()) / (n * (n - 1))
            within[(m, p)] = coll
            top = ', '.join(f'{o} {v / n:.0%}' for o, v in c.most_common(3))
            print(f'| {m.split("/")[-1]} | {p} | {n} | {top} | {coll:.2f} |')
    print('\n## Same mark from two DIFFERENT models: probability (per palette)')
    for p in PALETTES:
        print(f'\n{p}:')
        print('| | ' + ' | '.join(m.split('/')[-1] for m in MODELS) + ' |')
        print('|---|' + '---|' * len(MODELS))
        for a in MODELS:
            cells = []
            for b in MODELS:
                ca, cb = dist[(a, p)], dist[(b, p)]; na, nb = sum(ca.values()), sum(cb.values())
                if a == b: cells.append(f'**{within.get((a, p), float("nan")):.2f}**')
                else: cells.append(f'{sum(ca[o] * cb[o] for o in ca) / (na * nb):.2f}' if na and nb else '-')
            print(f'| {a.split("/")[-1]} | ' + ' | '.join(cells) + ' |')
    # Attribution: a synthetic session = the i-th draw from each palette; leave-one-out naive Bayes with add-one smoothing.
    sess = collections.defaultdict(dict)
    for r in ok:
        sess[(r['model'], r['i'])][r['palette']] = r['choice']
    def classify(feats, exclude, labels, label_of):
        best, bestlp = None, -1e9
        for lab in labels:
            lp = 0.0
            for p, ch in feats.items():
                c = collections.Counter(); n = 0
                for m in MODELS:
                    if label_of(m) != lab: continue
                    c.update(dist[(m, p)]); n += sum(dist[(m, p)].values())
                cnt = c[ch] - (1 if label_of(exclude) == lab else 0)
                nn = n - (1 if label_of(exclude) == lab else 0)
                lp += math.log((cnt + 1) / (nn + K))
            if lp > bestlp: best, bestlp = lab, lp
        return best
    print('\n## Can one session be attributed from its marks? (leave-one-out naive Bayes; chance = 20% model, 33% family)')
    print('| marks used | model accuracy | family accuracy |')
    print('|---|---|---|')
    for used in [['animals'], ['numbers'], ['syllables'], ['symbols'], list(PALETTES)]:
        hm = hf = tot = 0
        for (m, i), feats in sess.items():
            f = {p: feats[p] for p in used if p in feats}
            if len(f) != len(used): continue
            tot += 1
            hm += classify(f, m, MODELS, lambda x: x) == m
            hf += classify(f, m, sorted(set(FAMILY.values())), lambda x: FAMILY[x]) == FAMILY[m]
        print(f'| {"+".join(used)} | {hm / tot:.0%} ({tot} sessions) | {hf / tot:.0%} |')
    print('\n## Position bias (order was shuffled every call; uniform = 8% per position)')
    print('| model | chose the FIRST listed | chose the LAST listed | n |')
    print('|---|---|---|---|')
    for m in MODELS:
        n = sum(pos[m].values())
        if n: print(f'| {m.split("/")[-1]} | {pos[m][0] / n:.0%} | {pos[m][K - 1] / n:.0%} | {n} |')


if __name__ == '__main__':
    if sys.argv[1] == 'run':
        run(int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 40)
    else:
        analyse()
