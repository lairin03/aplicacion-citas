import Link from "next/link";
import { BusinessForm } from "@/components/onboarding/business-form";

export default function NewLocationPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/panel" className="text-sm font-semibold text-lime-800">← Volver a la agenda</Link>
      <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-lime-800">Nueva sede</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Configura otra ubicación</h1>
      <p className="mt-2 mb-8 text-slate-600">Esta sede tendrá su propia agenda, servicios y enlace de reservas.</p>
      <BusinessForm />
    </div>
  );
}
