import Image from "next/image";
import { notFound } from "next/navigation";
import { FileText, MapPin, Scissors } from "lucide-react";
import { BookingFlow } from "@/components/booking/booking-flow";
import { businessLocalDate } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  const admin = createAdminClient();
  const { data: business, error: businessError } = await admin.from("businesses")
    .select("id, owner_id, name, slug, type, phone, whatsapp, address, timezone, logo_url, brand_color, font_family")
    .eq("slug", slug).maybeSingle();
  if (businessError) throw new Error("No se pudo cargar el negocio.");
  if (!business) notFound();

  const [{ data: services, error: servicesError }, { data: staff, error: staffError }, { data: offerings, error: offeringsError }] = await Promise.all([
    admin.from("services").select("id, name, duration_minutes, price_cop")
      .eq("business_id", business.id).eq("is_active", true).order("name"),
    admin.from("staff").select("id, name").eq("business_id", business.id).eq("is_active", true).not("email", "is", null).order("name"),
    admin.from("staff_services").select("staff_id, service_id").eq("business_id", business.id),
  ]);
  if (servicesError || staffError || offeringsError) throw new Error("No se pudo cargar la información de reservas.");
  const publicStaff = (staff ?? []).map((person) => ({
    ...person,
    serviceIds: (offerings ?? []).filter((offer) => offer.staff_id === person.id).map((offer) => offer.service_id),
  }));
  const today = businessLocalDate(new Date(), business.timezone);
  const fontFamily = business.font_family === "serif"
    ? "Georgia, 'Times New Roman', serif"
    : business.font_family === "mono"
      ? "var(--font-geist-mono), monospace"
      : "var(--font-geist-sans), Arial, sans-serif";

  return (
    <main className="min-h-screen bg-[#faf9f6] pb-12" style={{ fontFamily }}>
      <header className="bg-slate-950 px-5 pb-10 pt-7 text-white sm:pb-14">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.2em]" style={{ color: business.brand_color }}>Agenda Clara</p>
          <div className="mt-5 flex items-center gap-4">
            {business.logo_url
              ? isPdfLogo(business.logo_url)
                ? <a href={business.logo_url} target="_blank" rel="noreferrer" aria-label="Abrir logo PDF" className="flex h-16 w-16 flex-col items-center justify-center rounded-2xl bg-white/10" style={{ color: business.brand_color }}><FileText size={28} /><span className="text-[10px] font-bold">PDF</span></a>
                : <Image src={business.logo_url} alt="" width={64} height={64} unoptimized className="h-16 w-16 rounded-2xl object-cover" />
              : <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10" style={{ color: business.brand_color }}><Scissors /></div>}
            <div><h1 className="text-2xl font-bold sm:text-3xl">{business.name}</h1><p className="mt-1 text-sm capitalize text-slate-300">{business.type}</p></div>
          </div>
          {business.address && <p className="mt-4 flex items-center gap-2 text-sm text-slate-300"><MapPin size={16} />{business.address}</p>}
        </div>
      </header>
      <div className="mx-auto -mt-5 grid max-w-3xl gap-5 px-4 sm:px-5">
        <BookingFlow business={business} services={services ?? []} staff={publicStaff} today={today} />
        <p className="text-center text-xs text-slate-500">La disponibilidad se actualiza al confirmar para evitar cruces de horario.</p>
      </div>
    </main>
  );
}

function isPdfLogo(url: string) {
  return /\.pdf(?:$|[?#])/i.test(url);
}
