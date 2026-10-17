import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { findPublicBusiness, getAvailableSlots, isBusinessPlanActive } from "@/lib/public-booking";

const querySchema = z.object({
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  serviceIds: z.string().transform((value) => value.split(",")).pipe(z.array(z.uuid()).min(1)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: z.uuid().optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success || !isRealDate(parsed.data.date)) {
    return NextResponse.json({ error: "Parámetros de disponibilidad inválidos." }, { status: 400 });
  }

  try {
    const business = await findPublicBusiness(parsed.data.slug);
    if (!business) return NextResponse.json({ error: "No encontramos este negocio." }, { status: 404 });
    if (!(await isBusinessPlanActive(business.owner_id))) {
      return NextResponse.json({ error: "Este negocio debe activar un plan para recibir nuevas reservas." }, { status: 402 });
    }
    const slots = await getAvailableSlots({
      business,
      serviceIds: parsed.data.serviceIds,
      date: parsed.data.date,
      staffId: parsed.data.staffId,
    });
    return NextResponse.json({ slots });
  } catch (error) {
    console.error("Error consultando disponibilidad pública:", error);
    return NextResponse.json({ error: "No se pudo consultar la disponibilidad. Intenta más tarde." }, { status: 500 });
  }
}

function isRealDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
