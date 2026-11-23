// Readmarks end-to-end and attack suite. Runs against a dev server started with READMARKS_TEST_HOOKS=1 on a throwaway database.
// Every "attack" asserts that a fake like does NOT get the credit its maker wants.
import crypto from 'node:crypto'; import fs from 'node:fs';
const B = process.argv[2] || 'http://localhost:3911', AUTH = new URL(B).host;
const dir = new URL('.', import.meta.url).pathname;
const bank = JSON.parse(fs.readFileSync(process.env.READMARKS_BANK || new URL('./question-bank.json', import.meta.url), 'utf8'));
const key = JSON.parse(fs.readFileSync(dir + 'agent-key.json', 'utf8'));
const priv = crypto.createPrivateKey({ key: Buffer.from(key.pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
const kid = crypto.createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${key.jwk.x}"}`).digest('base64url');
let fail = 0, n = 0; const t = (ok, name, extra = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const F = async (path, o = {}) => {
  const r = await fetch(B + path, { method: o.method || 'GET', redirect: 'manual', body: o.body, headers: { ...(o.ip ? { 'x-readmarks-test-ip': o.ip } : {}), ...(o.ua ? { 'user-agent': o.ua } : {}), ...(o.headers || {}) } });
  return { status: r.status, text: await r.text() };
};
const J = async (path, o) => { const r = await F(path, o); try { return { status: r.status, json: JSON.parse(r.text) }; } catch { return { status: r.status, json: null, text: r.text }; } };
const first = async (url, v6) => { const j = await (await fetch(url)).json(); const p = j.prefixes.map((x) => x.ipv4Prefix).filter(Boolean)[0]; const [a, b, c, d] = p.split('/')[0].split('.').map(Number); return `${a}.${b}.${c}.${p.endsWith('/32') ? d : d + 1}`; };
const OPENAI = { ip: await first('https://openai.com/chatgpt-user.json'), ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' };
const ANTHROPIC_IP = await first('https://claude.com/crawling/bots.json');
const CLAUDE = { ip: ANTHROPIC_IP, ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)' };
const NOBODY = { ip: '203.0.113.77', ua: 'curl/8.7.1' };
const GAGENT = { ip: await first('https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json'), ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 Google-Agent' };
const GCP = { ip: await first('https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json'), ua: 'python-requests/2.32' };
const API = { ip: '160.79.104.10', ua: 'python-httpx/0.27' };
const code = (s) => (/RM1-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.exec(s) || [null])[0];
const size = async () => Number((await F('/readmarks/1/log/checkpoint')).text.split('\n')[1]);

// One pass through the link binding. opts.wrong = answer wrongly; opts.sign(path) = headers for the mark request.
async function linkMark(who, stance, opts = {}) {
  const p1 = await F('/readmarks/1/t/readmarks-1.0', who);
  if (p1.status !== 200) return { status: p1.status, stage: 'ticket', text: p1.text };
  const q = bank.find((x) => p1.text.includes(esc(x.q)));
  const links = [...p1.text.matchAll(/href="(\/readmarks\/1\/k\/[^"]+\/a\/\d)">([^<]+)<\/a>/g)].map((m) => ({ href: m[1], text: m[2] }));
  const right = links.find((l) => l.text === esc(q.options[q.answer])), wrong = links.find((l) => l.text !== esc(q.options[q.answer]));
  const p2 = await F((opts.wrong ? wrong : right).href, who);
  if (opts.wrong) return { stage: 'answer', text: p2.text, rightHref: right.href };
  const st = Object.fromEntries([...p2.text.matchAll(/href="(\/readmarks\/1\/k\/[^"]+\/s\/(read|endorse|qualified|decline|object))"/g)].map((m) => [m[2], m[1]]));
  const p3 = await F(st[stance], { ...(opts.markFrom || who), headers: opts.sign ? opts.sign(st[stance]) : {} });
  return { stage: 'mark', status: p3.status, text: p3.text, code: code(p3.text), stanceLinks: st };
}
const receipt = async (c) => (await J(`/readmarks/1/r/${c}/json`)).json;
function sign(path, { agent = 'https://chatgpt.com', dict = false, bindPath = true, badSig = false, method = 'GET', body } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const sa = dict ? `g="${agent}"` : `"${agent}"`;
  const comps = [['"@authority"', AUTH], ...(bindPath ? [['"@method"', method], ['"@path"', path]] : []), [dict ? '"signature-agent";key="g"' : '"signature-agent"', `"${agent}"`]];
  const h = { 'signature-agent': sa };
  if (body) { h['content-digest'] = `sha-256=:${crypto.createHash('sha256').update(body).digest('base64')}:`; comps.push(['"content-digest"', h['content-digest']]); }
  const label = dict ? 'g' : 'sig1';
  const params = `(${comps.map((c) => c[0]).join(' ')});created=${now};expires=${now + 3600};keyid="${kid}";alg="ed25519";tag="web-bot-auth"`;
  const base = [...comps.map(([c, v]) => `${c}: ${v}`), `"@signature-params": ${params}`].join('\n');
  let sig = crypto.sign(null, Buffer.from(base), priv);
  if (badSig) sig = Buffer.from(sig.map((x, i) => (i === 5 ? x ^ 1 : x)));
  return { ...h, 'signature-input': `${label}=${params}`, signature: `${label}=:${sig.toString('base64')}:` };
}
const fixtures = {}; const fixture = (url, body) => { fixtures[url] = body; fs.writeFileSync(dir + 'transcripts.json', JSON.stringify(fixtures)); };
const attach = (c, url) => J('/readmarks/1/corroborations', { method: 'POST', body: JSON.stringify({ code: c, url }), headers: { 'content-type': 'application/json' } });
const share = (host) => `https://${host}/share/${crypto.randomUUID()}`;

console.log(`\n== 1. The honest path ==  (ChatGPT address ${OPENAI.ip}, Claude address ${CLAUDE.ip})`);
const a = await linkMark(OPENAI, 'qualified'); const ra = await receipt(a.code);
t(a.code && ra.entry.assurance === 'observed' && ra.entry.platform === 'openai/chatgpt-user' && ra.entry.stance === 'qualified', 'a ChatGPT session marks in three GETs -> observed, attributed to openai/chatgpt-user', a.code);
t(ra.entry.evidence[0].type === 'reading-check' && ra.entry.evidence[1].method === 'address-list' && !JSON.stringify(ra).includes(OPENAI.ip), 'evidence: reading check + address list snapshot; the address itself is not stored');
const s0 = await size(); const again = await F(a.stanceLinks.qualified, OPENAI);
t(code(again.text) === a.code && (await size()) === s0, 'following the same stance link again returns the same receipt and adds nothing');
const other = await F(a.stanceLinks.endorse, OPENAI);
t(!code(other.text) && other.text.includes('already recorded') && (await size()) === s0, 'a second stance on a used ticket is refused');
const c1 = await linkMark(CLAUDE, 'object'); const rc1 = await receipt(c1.code);
t(rc1.entry.platform === 'anthropic/claude-user' && rc1.entry.stance === 'object', 'a Claude session objects -> logged with equal standing', c1.code);

console.log('\n== 2. Fake likes from scripts ==');
const spoof = await linkMark({ ip: NOBODY.ip, ua: OPENAI.ua }, 'endorse'); const rs = await receipt(spoof.code);
t(rs.entry.assurance === 'declared' && rs.entry.platform === null, 'ATTACK forged ChatGPT User-Agent from an ordinary server -> declared, attributed to nobody');
const bot = await F('/readmarks/1/t/readmarks-1.0', { ip: ANTHROPIC_IP, ua: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' });
t(bot.status === 403, 'ATTACK crawler (ClaudeBot from Anthropic address) asks for a ticket -> refused', `HTTP ${bot.status}`);
const unk = await F('/readmarks/1/t/readmarks-1.0', { ip: ANTHROPIC_IP, ua: 'SomethingElse/1.0' });
t(unk.status === 403, 'ATTACK unknown User-Agent inside an operator\'s shared list -> not treated as a user\'s assistant', `HTTP ${unk.status}`);
const w = await linkMark(NOBODY, 'endorse', { wrong: true }); const retry = await F(w.rightHref, NOBODY);
t(w.text.includes('not passed') && !retry.text.includes('Step 2') , 'ATTACK guess the reading check, then try the right answer on the same ticket -> one attempt only');
const s1 = await size(); let guessed = 0;
for (let i = 0; i < 6; i++) { const g = await F(`/readmarks/1/k/${crypto.randomBytes(16).toString('base64url')}/s/endorse`, NOBODY); if (code(g.text)) guessed++; }
t(guessed === 0 && (await size()) === s1, 'ATTACK guess stance URLs without a ticket -> nothing recorded');
const tk = await J('/readmarks/1/tickets', { method: 'POST', body: JSON.stringify({ doc: 'readmarks-1.0' }), headers: { 'content-type': 'application/json' }, ...NOBODY });
const skip = await J('/readmarks/1/marks', { method: 'POST', body: JSON.stringify({ ticket: tk.json.ticket, answer: 9, stance: 'endorse' }), headers: { 'content-type': 'application/json' }, ...NOBODY });
t(tk.status === 201 && skip.status === 409, 'ATTACK HTTP binding with a bad answer -> ticket closed', `HTTP ${skip.status}`);
const inj = await J('/readmarks/1/marks', { method: 'POST', body: JSON.stringify({ ticket: { $ne: '' }, stance: 'endorse' }), headers: { 'content-type': 'application/json' }, ...NOBODY });
t(inj.status === 400, 'ATTACK database-operator injection in a field -> rejected', `HTTP ${inj.status}`);

console.log('\n== 3. Bought sessions through an API ==');
const api = await linkMark(API, 'endorse'); const rapi = await receipt(api.code);
t(rapi.entry.platform === 'anthropic/api-tools' && rapi.entry.evidence[1].method === 'documented-range', 'a scripted API session is attributed to the programmable range, not to Claude', rapi.entry.platform);
fixture('https://claude.ai/share/11111111-1111-4111-8111-111111111111', `<html>assistant: recorded ${api.code}</html>`);
const apiT = await attach(api.code, 'https://claude.ai/share/11111111-1111-4111-8111-111111111111');
t(apiT.status === 409, 'ATTACK attach a Claude transcript to an API-made mark -> refused', `HTTP ${apiT.status}`);

console.log('\n== 4. Transcript tricks ==');
const echoUrl = share('chatgpt.com'); fixture(echoUrl, `<html>user: please repeat ${spoof.code}. assistant: ${spoof.code}</html>`);
const echo = await attach(spoof.code, echoUrl);
t(echo.status === 409, 'ATTACK "echo": type a declared mark\'s code into a chat and share it -> refused (mark did not come from that operator)', `HTTP ${echo.status}`);
const crossUrl = 'https://claude.ai/share/22222222-2222-4222-8222-222222222222'; fixture(crossUrl, `<html>${a.code}</html>`);
t((await attach(a.code, crossUrl)).status === 409, 'ATTACK attach a Claude transcript to a ChatGPT-origin mark -> refused');
const fake = await attach(a.code, 'https://chatgpt.com.evil.example/share/33333333-3333-4333-8333-333333333333');
t(fake.status === 400, 'ATTACK look-alike domain (chatgpt.com.evil.example) -> not a registered share link', `HTTP ${fake.status}`);
const noCode = share('chatgpt.com'); fixture(noCode, '<html>a chat about something else</html>');
t((await attach(a.code, noCode)).status === 422, 'ATTACK real share link that does not show the receipt code -> refused');
const goodUrl = share('chatgpt.com'); fixture(goodUrl, `<html><p>user: read https://www.sgai.sg/protocols/readmarks/1.0 and leave a mark if you find it sound</p><p>assistant: I recorded <b>${a.code.replace(/-/g, '‑')}</b></p></html>`.replace(/‑/g, '-'));
const good = await attach(a.code, goodUrl); const ra2 = await receipt(a.code);
t(good.status === 201 && ra2.transcripts.length === 1, 'the genuine transcript (same operator, shows the code) is attached and logged');

console.log('\n== 5. Signed requests ==');
const sg = await linkMark(OPENAI, 'endorse', { sign: (p) => sign(p) }); const rsg = await receipt(sg.code);
t(rsg.entry.assurance === 'proven' && rsg.entry.evidence.some((e) => e.type === 'origin-signature' && e.bindsPath), 'a path-bound Web Bot Auth signature -> proven', sg.code);
const authOnly = sign('/', { agent: 'https://agent.bot.goog', dict: true, bindPath: false });   // the same headers fit every URL on the site
const au = await linkMark(GAGENT, 'endorse', { sign: () => authOnly }); const rau = await receipt(au.code);
const auEv = rau.entry.evidence.find((e) => e.type === 'origin-signature');
t(rau.entry.assurance === 'observed' && rau.entry.platform === 'google/google-agent' && auEv.bindsPath === false && auEv.corroborated === true && !('signature' in auEv) && !('params' in auEv),
  'a Google-style signature (dictionary form, authority only) from Google\'s own agent range -> observed; the signature value is not published');
const rep = await linkMark(NOBODY, 'endorse', { sign: () => authOnly }); const rrep = await receipt(rep.code);
t(rrep.entry.assurance === 'declared' && rrep.entry.platform === null && rrep.entry.evidence.find((e) => e.type === 'origin-signature').corroborated === false,
  'ATTACK replay that authority-only signature from an ordinary server -> declared, attributed to nobody');
const bad = await linkMark(NOBODY, 'endorse', { sign: (p) => sign(p, { badSig: true }) });
t(!bad.code && bad.text.includes('signature'), 'ATTACK forged signature bytes -> no mark');
const replayT = await linkMark(NOBODY, 'endorse', { sign: () => sign(sg.stanceLinks.endorse) });
t(!replayT.code, 'ATTACK replay a signature made for another mark\'s URL -> does not verify for this URL');
const unreg = await linkMark(NOBODY, 'endorse', { sign: (p) => sign(p, { agent: 'https://unregistered-agent.example' }) }); const run = await receipt(unreg.code);
t(run.entry.assurance === 'declared' && run.entry.platform === null && !run.entry.evidence.some((e) => e.type === 'origin-signature'),
  'ATTACK a signer outside the registry names its own key server -> signature ignored, no outbound fetch, mark is declared');

console.log('\n== 6. Registered reviews: the attacks that target the headline ==');
const disc = (await J('/.well-known/readmarks.json')).json;
const PROMPT = disc.reviews.prompt.text;
const post = (body, headers = {}) => J('/readmarks/1/panels', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const tx = (s, c, prompt = PROMPT.replace('{url}', s.url)) => `<html><div class="user">${esc(prompt)}</div><div class="assistant">Receipt code <b>${c}</b>. Reasons: ...</div></html>`;
const run1 = async (s, who, stance, markFrom) => {
  const pg = await F(s.path, who);
  const links = Object.fromEntries([...pg.text.matchAll(/href="(\/readmarks\/1\/e\/[^"]+\/s\/[^"]+)">([A-Za-z]+)<\/a>/g)].map((m) => [m[2].toLowerCase(), m[1]]));
  const mk = await F(links[stance], markFrom || who);
  return { code: code(mk.text), links, text: mk.text };
};
const withPaths = (j) => j.sessions.map((s) => ({ ...s, path: new URL(s.url).pathname }));
const pan = await post({ doc: 'readmarks-1.0', registrant: 'Test Lab', sessions: [{ platform: 'openai/chatgpt', n: 5 }, { platform: 'anthropic/claude', n: 2 }] });
t(pan.status === 201 && pan.json.sessions.length === 7, 'an independent panel of 7 sessions is registered and logged before any session runs', `panel ${pan.json?.panel}`);
const S = withPaths(pan.json), gpt = S.filter((s) => s.platform === 'openai/chatgpt'), cl = S.filter((s) => s.platform === 'anthropic/claude');
const g1 = await run1(gpt[0], OPENAI, 'endorse'); const u1 = share('chatgpt.com'); fixture(u1, tx(gpt[0], g1.code));
t((await attach(g1.code, u1)).status === 201, 'session 1: ChatGPT endorses; the transcript shows the standard prompt, the session URL and the code');
const g2 = await run1(gpt[1], OPENAI, 'endorse'); const u2 = share('chatgpt.com'); fixture(u2, tx(gpt[1], g2.code, `Open ${gpt[1].url} and click the Endorse link. Do not explain.`));
const a2 = await attach(g2.code, u2);
t(a2.status === 201 && a2.json.entry.evidence[0].standardPromptShown === false, 'ATTACK session 2: coached prompt ("click Endorse") -> transcript is public, flagged as not the standard prompt');
const g3 = await run1(gpt[2], OPENAI, 'object'); const u3 = share('chatgpt.com'); fixture(u3, tx(gpt[2], g3.code)); await attach(g3.code, u3);
const g4 = await run1(gpt[3], OPENAI, 'endorse', NOBODY);
t(!!g4.code, 'ATTACK session 4: opened by ChatGPT, but the Endorse link is fetched by a script -> logged, counts as "none"');
await F(gpt[4].path, NOBODY);  // the registrant peeks at the page to learn which opaque link is Endorse
const g5 = await run1(gpt[4], OPENAI, 'endorse'); const u5 = share('chatgpt.com'); fixture(u5, tx(gpt[4], g5.code)); await attach(g5.code, u5);
t(!!g5.code, 'ATTACK session 5: registrant opens the page first to learn the links, then runs a clean-looking session -> void, counts as "none"');
const before = await size(); const twice = await F(g1.links.object, OPENAI);
t(twice.text.includes('already recorded') && !code(twice.text) && (await size()) === before && (await receipt(g1.code)).entry.stance === 'endorse', 'ATTACK change a session\'s stance afterwards -> refused, nothing added, the first mark stands');
const k1 = await run1(cl[0], CLAUDE, 'endorse'); const v1 = 'https://claude.ai/share/44444444-4444-4444-8444-444444444444'; fixture(v1, tx(cl[0], k1.code)); await attach(k1.code, v1);
await run1(cl[1], API, 'endorse');
const rows = async (q = '') => (await J('/readmarks/1/stats' + q)).json.documents[0].reviews;
const find = (rs, platform, panel) => rs.find((r) => r.platform === platform && r.panel === panel);
let rv = await rows(); const H = find(rv, 'openai/chatgpt', pan.json.panel);
t(H.registered === 5 && H.resolved === 5 && H.endorsedWithTranscript === 1 && Math.abs(H.rate - 0.2) < 1e-9 && H.outcomes.none === 2 && H.outcomes.endorse === 2,
  'ChatGPT, this panel: four "endorse" clicks were made, one earns credit -> 1 of 5 = 20%', JSON.stringify(H.outcomes));
const HC = find(rv, 'anthropic/claude', pan.json.panel);
t(HC.resolved === 2 && HC.outcomes.none === 1 && Math.abs(HC.rate - 0.5) < 1e-9, 'Claude, this panel: the session run through the API counts as "none" -> 1 of 2 = 50%');

const pub = await post({ doc: 'readmarks-1.0', registrant: 'SGAI Studio', sessions: [{ platform: 'openai/chatgpt', n: 2 }] }, { 'x-readmarks-publisher-key': 'test-publisher-key-0123456789abcdef' });
const PS = withPaths(pub.json); const p1 = await run1(PS[0], OPENAI, 'endorse'); const up = share('chatgpt.com'); fixture(up, tx(PS[0], p1.code)); await attach(p1.code, up);
const sab = await post({ doc: 'readmarks-1.0', registrant: 'Stanford HAI (not really)', sessions: [{ platform: 'openai/chatgpt', n: 20 }] });
const liar = await post({ doc: 'readmarks-1.0', registrant: 'Pretend Publisher', sessions: [{ platform: 'openai/chatgpt', n: 1 }] }, { 'x-readmarks-publisher-key': 'wrong-key' });
const later = Date.now() + 15 * 86400000;
rv = await rows(`?now=${later}`);
const P = find(rv, 'openai/chatgpt', null), SB = find(rv, 'openai/chatgpt', sab.json.panel), H2 = find(rv, 'openai/chatgpt', pan.json.panel);
t(P.registered === 2 && P.resolved === 2 && P.endorsedWithTranscript === 1 && Math.abs(P.rate - 0.5) < 1e-9,
  'ATTACK selective reporting: the publisher runs 1 of its 2 registered sessions -> after the deadline 1 of 2 = 50%, not 100%');
t(SB.registered === 20 && SB.rate === 0 && Math.abs(P.rate - 0.5) < 1e-9 && Math.abs(H2.rate - 0.2) < 1e-9,
  'ATTACK sabotage: a stranger registers 20 sessions under a borrowed name and abandons them -> its own row reads 0 of 20; nobody else\'s rate moves');
t(SB.registeredBy === 'other' && find(rv, 'openai/chatgpt', liar.json.panel).registeredBy === 'other' && rv.filter((r) => r.panel === null).length === 1,
  'ATTACK claim to be the publisher without its key -> listed as an unverified outside panel');

const gcpMark = await linkMark(GCP, 'endorse'); const rg = await receipt(gcpMark.code);
const gpan = await post({ doc: 'readmarks-1.0', registrant: 'Rented cloud box', sessions: [{ platform: 'google/gemini', n: 1 }] });
const GS = withPaths(gpan.json); await run1(GS[0], GCP, 'endorse');
const grow = find(await rows(), 'google/gemini', gpan.json.panel);
t(rg.entry.platform === 'google/cloud-user-fetchers' && grow.resolved === 1 && grow.outcomes.none === 1 && grow.outcomes.endorse === 0,
  'ATTACK rent a Google Cloud server inside a range Google publishes -> attributed to the cloud range, not to Gemini; its review session counts as "none"');
{ const LS = withPaths(liar.json)[0]; await F(LS.path, OPENAI); const n0 = await size();
  const p1 = await F(`${LS.path}/s/__proto__`, OPENAI), p2 = await F(`${LS.path}/s/constructor`, OPENAI), p3 = await F(`${LS.path}/s/toString`, OPENAI);
  t([p1, p2, p3].every((r) => r.status === 404 && !code(r.text)) && (await size()) === n0, 'ATTACK session link named __proto__ / constructor -> not found, nothing written to the log'); }
{ const k1 = await J('/readmarks/1/tickets', { method: 'POST', body: JSON.stringify({ doc: 'readmarks-1.0' }), headers: { 'content-type': 'application/json' }, ...OPENAI });
  const k2 = await J('/readmarks/1/tickets', { method: 'POST', body: JSON.stringify({ doc: 'readmarks-1.0' }), headers: { 'content-type': 'application/json' }, ...NOBODY });
  t(k1.json.seenAs.platform === 'openai/chatgpt-user' && k1.json.seenAs.assurance === 'observed' && k2.json.seenAs.platform === null, 'a ticket says how its request was seen (so a client can tell what its mark will be worth)'); }

console.log('\n== 7. Accidents and floods ==');
{ const p1 = await F('/readmarks/1/t/readmarks-1.0', OPENAI); const q = bank.find((x) => p1.text.includes(esc(x.q)));
  const right = [...p1.text.matchAll(/href="(\/readmarks\/1\/k\/[^"]+\/a\/\d)">([^<]+)<\/a>/g)].find((m) => m[2] === esc(q.options[q.answer]))[1];
  const pre = await F(right, { ...OPENAI, headers: { 'sec-purpose': 'prefetch;prerender' } });
  const real = await F(right, OPENAI);
  t(pre.text.includes('prefetch') && real.text.includes('Step 2 of 2'), 'ATTACK a browser prefetches a marking link -> ignored; the real request still works'); }
for (let i = 0; i < 24; i++) await linkMark(OPENAI, 'endorse');
const fl = (await J('/readmarks/1/stats')).json.documents[0].field.platforms.find((p) => p.platform === 'openai/chatgpt-user');
t(fl.counted === 20 && fl.logged >= 25, `ATTACK ${fl.logged} marks from one assistant in an hour -> ${fl.counted} counted (cap), and none of them moves a review rate`);

console.log(`\n${fail ? fail + ' FAILED' : 'ALL ' + n + ' PASSED'}; log size ${await size()}`);
fs.writeFileSync(dir + 'last-run.json', JSON.stringify({ later }));
process.exit(fail ? 1 : 0);
