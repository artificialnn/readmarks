// Every figure the page shows, recomputed from the log by the two counting rules.
import { stats } from '@/lib/readmarks/mark';
import { json } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Test hook, never active in production builds: evaluate the rules as of another moment (to test deadlines).
  const t = process.env.NODE_ENV !== 'production' && process.env.READMARKS_TEST_HOOKS === '1' ? Number(new URL(req.url).searchParams.get('now')) : 0;
  return json(200, { readmarks: '1.0', rules: { C1: 'ordinary marks: attributed marks counted in log order, at most 20 per platform per document per UTC hour; shown as activity, never as a headline',
    C2: 'registered reviews: endorsements with a confirmed public transcript, divided by ALL registered sessions that are resolved (intention-to-treat); 95% Wilson interval' }, ...(await stats(t || undefined)) },
  { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' });
}
