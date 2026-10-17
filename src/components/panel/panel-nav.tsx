import Link from "next/link";
import Image from "next/image";
import { BarChart3, CalendarDays, Clock4, FileText, MapPinPlus, Settings, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { BusinessSelector } from "@/components/panel/business-selector";

const baseLinks = [
  { href: "/panel", label: "Agenda", icon: CalendarDays },
  { href: "/panel/historial", label: "Historial", icon: Clock4 },
  { href: "/panel/clientes", label: "Clientes", icon: UsersRound },
  { href: "/panel/configuracion", label: "Configuración", icon: Settings },
];

type BusinessOption = { id: string; name: string };

export function PanelNav({
  businessName,
  logoUrl,
  businesses,
  activeBusinessId,
  canAddLocation,
  hasProfessionalFeatures,
  isSuperAdmin,
}: {
  businessName: string;
  logoUrl: string | null;
  businesses: BusinessOption[];
  activeBusinessId: string;
  canAddLocation: boolean;
  hasProfessionalFeatures: boolean;
  isSuperAdmin: boolean;
}) {
  const links = [
    ...(businesses.length ? baseLinks : []),
    ...(hasProfessionalFeatures ? [
      { href: "/panel/caja", label: "Caja", icon: WalletCards },
      { href: "/panel/reportes", label: "Reportes", icon: BarChart3 },
    ] : []),
    ...(isSuperAdmin ? [
      { href: "/admin", label: "Super Admin", icon: ShieldCheck },
    ] : []),
  ];
  const pdfLogo = logoUrl ? /\.pdf(?:$|[?#])/i.test(logoUrl) : false;
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {logoUrl && pdfLogo && <BusinessLogo logoUrl={logoUrl} />}
            <Link href="/panel" className="flex min-w-0 items-center gap-2 font-bold">
              {logoUrl && !pdfLogo && <BusinessLogo logoUrl={logoUrl} />}
              <span className="truncate">{businessName}</span>
            </Link>
          </div>
          <form action={signOutAction}><button className="text-sm font-medium text-slate-600">Salir</button></form>
        </div>
        {businesses.length > 1 && <BusinessSelector
          businesses={businesses}
          activeBusinessId={activeBusinessId}
          id="active-business-mobile"
          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
        />}
        <nav className="flex justify-around overflow-x-auto border-t border-slate-100 px-2 py-2">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-label={label} className="flex shrink-0 flex-col items-center gap-1 px-2 py-1 text-[11px] text-slate-600">
              <Icon size={18} /><span className="whitespace-nowrap">{label}</span>
            </Link>
          ))}
        </nav>
      </header>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-5 md:flex md:flex-col">
        <div className="flex min-w-0 items-center gap-3 text-lg font-bold">
          {logoUrl && pdfLogo && <BusinessLogo logoUrl={logoUrl} />}
          <Link href="/panel" className="flex min-w-0 items-center gap-3">
            {logoUrl && !pdfLogo && <BusinessLogo logoUrl={logoUrl} />}
            <span className="truncate">{businessName}<span className="text-amber-600">.</span></span>
          </Link>
        </div>
        <p className="mt-1 text-xs uppercase tracking-wider text-slate-400">
          {isSuperAdmin ? "Superadministración · Profesional ilimitado" : "Panel del negocio"}
        </p>
        <nav className="mt-8 space-y-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-amber-50 hover:text-amber-800">
              <Icon size={18} />{label}
            </Link>
          ))}
        </nav>
        {canAddLocation && <Link href="/panel/sedes/nueva" className="mt-4 flex items-center gap-3 rounded-xl bg-lime-100 px-3 py-2.5 text-sm font-semibold text-lime-950 hover:bg-lime-200">
          <MapPinPlus size={18} />Agregar sede
        </Link>}
        {businesses.length > 1 && <BusinessSelector
          businesses={businesses}
          activeBusinessId={activeBusinessId}
          id="active-business"
          className="form-input mt-2 text-sm"
        />}
        <div className="mt-auto">
          <form action={signOutAction}><button className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50">Cerrar sesión</button></form>
        </div>
      </aside>
    </>
  );
}

function BusinessLogo({ logoUrl }: { logoUrl: string }) {
  if (/\.pdf(?:$|[?#])/i.test(logoUrl)) {
    return <a href={logoUrl} target="_blank" rel="noreferrer" aria-label="Abrir logo PDF" className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-amber-50 text-amber-800">
      <FileText size={19} /><span className="text-[8px] font-bold">PDF</span>
    </a>;
  }
  return <Image src={logoUrl} alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-contain p-0.5" />;
}
