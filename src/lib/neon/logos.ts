import "server-only";
import { query } from "./database";

const logoTypes = {
  "image/png": { extension: "png", valid: (bytes: Buffer) => bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" },
  "image/jpeg": { extension: "jpg", valid: (bytes: Buffer) => bytes.subarray(0, 3).toString("hex") === "ffd8ff" },
  "image/webp": { extension: "webp", valid: (bytes: Buffer) =>
    bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" },
  "image/gif": { extension: "gif", valid: (bytes: Buffer) => /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) },
  "application/pdf": { extension: "pdf", valid: (bytes: Buffer) => bytes.subarray(0, 5).toString() === "%PDF-" },
};

export async function readLogoUpload(file: File) {
  const format = logoTypes[file.type as keyof typeof logoTypes];
  if (!format || !Object.hasOwn(logoTypes, file.type)) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!format.valid(bytes)) return null;
  return { filename: `${crypto.randomUUID()}.${format.extension}`, bytes, mime: file.type };
}

export function saveBusinessLogo(
  userId: string, businessId: string, url: string, logo: NonNullable<Awaited<ReturnType<typeof readLogoUpload>>>,
) {
  return query<{ business_id: string }>({ userId }, `
    with owned as (
      update public.businesses set logo_url = $2 where id = $1 returning id
    )
    insert into public.business_logos (business_id, filename, content_type, contents)
    select id, $3, $4, decode($5, 'base64') from owned
    on conflict (business_id) do update set filename = excluded.filename,
      content_type = excluded.content_type, contents = excluded.contents
    returning business_id
  `, [businessId, url, logo.filename, logo.mime, logo.bytes.toString("base64")]);
}

export function deleteBusinessLogo(userId: string, businessId: string) {
  return query<{ id: string }>({ userId }, `
    with owned as (
      update public.businesses set logo_url = null where id = $1 returning id
    ), removed as (
      delete from public.business_logos where business_id in (select id from owned)
    )
    select id from owned
  `, [businessId]);
}
