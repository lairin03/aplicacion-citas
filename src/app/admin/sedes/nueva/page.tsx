import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BusinessForm } from "@/components/onboarding/business-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

export default async function NewAdminLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ ownerId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  if (!isConfirmedSuperAdmin(user)) redirect("/panel");

  const { ownerId } = await searchParams;
  if (!ownerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    notFound();
  }

  const admin = createAdminClient();
  const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(ownerId);
  if (ownerError) throw new Error("No se pudo verificar la cuenta seleccionada.");
  if (!owner.user) notFound();

  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-8 sm:py-10">
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
      <Link href="/admin/suscripciones" className="text-sm font-semibold text-sky-800">← Volver a suscripciones</Link>
      <p className="mt-6 text-sm font-bold uppercase tracking-wider text-sky-700">Sede para una cuenta existente</p>
      <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Agregar sede</h1>
      <p className="mb-7 mt-2 break-all text-sm text-slate-600">
        La sede quedará asociada a <strong>{owner.user.email ?? "la cuenta seleccionada"}</strong> y respetará los límites de su suscripción.
      </p>
      <BusinessForm ownerId={ownerId} />
    </div>
  </main>;
}
