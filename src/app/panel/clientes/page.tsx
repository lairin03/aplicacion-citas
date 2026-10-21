import Link from "next/link";
import { getBusinessFeatureContext } from "@/lib/professional-access";

type SearchParams = Promise<{ q?: string }>;

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 80);
  const { supabase, business } = await getBusinessFeatureContext("customer_history");

  let customerQuery = supabase.from("customers")
    .select("id, name, phone, created_at").eq("business_id", business.id)
    .order("created_at", { ascending: false }).limit(100);
  if (query) customerQuery = customerQuery.ilike("name", `%${query}%`);
  const { data: customers, error } = await customerQuery;
  if (error) throw new Error("No se pudo cargar la lista de clientes.");

  return <div>
    <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
    <form className="mt-5 flex gap-2 rounded-2xl border border-slate-200 bg-white p-4">
      <input name="q" defaultValue={query} placeholder="Buscar por nombre" className="form-input mt-0" />
      <button className="rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Buscar</button>
    </form>
    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {!customers?.length && <p className="p-8 text-center text-sm text-slate-500">Aún no hay clientes registrados.</p>}
      {customers?.map((customer) => <Link key={customer.id} href={`/panel/clientes/${customer.id}`} className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-0 hover:bg-slate-50">
        <div><p className="font-semibold">{customer.name}</p><p className="mt-1 text-sm text-slate-500">{customer.phone}</p></div>
        <span className="text-sm font-semibold text-amber-800">Ver ficha</span>
      </Link>)}
    </div>
  </div>;
}
