// The origin registry, byte for byte as hashed in every mark.
import { RM_ORIGINS_RAW, RM_ORIGINS_SHA256 } from '@/lib/readmarks/spec.generated';

export const dynamic = 'force-static';

export function GET() {
  return new Response(RM_ORIGINS_RAW, { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300', 'x-content-sha256': RM_ORIGINS_SHA256 } });
}
