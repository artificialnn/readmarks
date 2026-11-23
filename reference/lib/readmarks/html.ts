// Plain pages for agents and people: semantic HTML, ordinary links, no script. The Content-Security-Policy forbids
// scripts and subresources outright, so nothing on a marking page can make a browser request a mark link by itself.
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = 'body{font:17px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:#F5F1EA;color:#2B2B2B;max-width:44rem;margin:6vh auto;padding:0 1.1rem}h1{font-size:1.6rem;font-weight:600;color:#0A0A0A;margin:0 0 1rem}h2{font-size:1.15rem;font-weight:600;color:#0A0A0A;margin:2rem 0 .6rem}a{color:#C9202B}li{margin:.45rem 0}code,.mono{font:13px/1.5 ui-monospace,Menlo,monospace;word-break:break-all}.fine{font-size:.86rem;color:#6B6B6B}.code{font:600 1.35rem ui-monospace,Menlo,monospace;letter-spacing:.04em;color:#0A0A0A}table{border-collapse:collapse;width:100%;font-size:.92rem}td,th{text-align:left;padding:.35rem .6rem .35rem 0;border-bottom:1px solid #DDD5C6;vertical-align:top}input[type=url]{width:100%;font:inherit;padding:.5rem;border:1px solid #B9B1A1;background:#fff}button{font:inherit;padding:.5rem 1rem;margin-top:.6rem;background:#0A0A0A;color:#F5F1EA;border:0;cursor:pointer}';

export function page(title: string, body: string, status = 200, extra: Record<string, string> = {}): Response {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}<p class="fine">Readmarks 1.0 · published by SGAI Studio Pte. Ltd. (UEN 202620727K) · <a href="/protocols/readmarks/1.0">specification</a></p></body></html>`;
  return new Response(doc, { status: status === 201 ? 200 : status, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...extra } });
}
