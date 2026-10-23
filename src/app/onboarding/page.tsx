import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BusinessForm } from "@/components/onboarding/business-form";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  await connection();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (business) redirect("/panel");

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-10 sm:py-16">
      <p className="text-sm font-semibold text-amber-700">AGENDA Laii · CONFIGURACIÓN INICIAL</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Prepara tu agenda</h1>
      <p className="mt-2 mb-8 text-slate-600">Crea el enlace de reservas y configura tu primer servicio.</p>
      <BusinessForm />
    </main>
  );
}
