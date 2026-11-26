import { query } from "@/lib/neon/database";
import { z } from "zod";

const parameters = z.object({
  businessId: z.uuid(),
  filename: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp|gif|pdf)$/),
});

export async function GET(_request: Request, { params }: { params: Promise<{ businessId: string; filename: string }> }) {
  const parsed = parameters.safeParse(await params);
  if (!parsed.success) return new Response(null, { status: 404 });

  const { businessId, filename } = parsed.data;
  const [logo] = await query<{ content_type: string; body: string }>("service", `
    select l.content_type, encode(l.contents, 'base64') as body
    from public.business_logos l join public.businesses b on b.id = l.business_id
    where l.business_id = $1 and l.filename = $2
      and right(b.logo_url, length($3)) = $3
  `, [businessId, filename, `/api/business-logos/${businessId}/${filename}`]);

  if (!logo) return new Response(null, { status: 404 });
  return new Response(Uint8Array.from(Buffer.from(logo.body, "base64")), {
    headers: {
      "Content-Type": logo.content_type,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}
