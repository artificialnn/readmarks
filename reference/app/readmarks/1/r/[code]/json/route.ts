// The same receipt as JSON: entry, leaf hash, inclusion proof (RFC 6962 audit path) and the signed checkpoint it verifies against.
import { fullReceipt, json } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await fullReceipt(code);
  if (!r) return json(404, { error: 'no such receipt' });
  return json(200, { ...r.receipt, transcripts: r.transcripts, text: r.texts });
}
