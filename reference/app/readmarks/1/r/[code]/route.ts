// A receipt, for people and agents: the entry, its evidence, where it sits in the log, and its public transcripts.
import { errorPage, receiptPage } from '@/lib/readmarks/pages';
import { fullReceipt } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await fullReceipt(code);
  if (!r) return errorPage(404, 'No such receipt', 'Receipt codes look like RM1-XXXX-XXXX-XXXX.');
  return receiptPage(r.receipt, { transcripts: r.transcripts, texts: r.texts });
}
