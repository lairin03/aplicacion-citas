import Link from "next/link";
import { ArrowDown, ArrowRight, CalendarCheck, Check, Clock3, ShieldCheck, Sparkles, UsersRound } from "lucide-react";

const benefits = [
  { icon: CalendarCheck, title: "Tu agenda, en orden", text: "Administra las citas y el equipo desde un solo lugar." },
  { icon: Clock3, title: "Reservas sin llamadas", text: "Tus clientes eligen sus servicios y horario en línea." },
  { icon: ShieldCheck, title: "Un negocio más organizado", text: "Historial de clientes, reportes y herramientas para crecer." },
];

const plans = [
  {
    name: "Básico",
    previousPrice: "$49.900",
    price: "$29.900",
    discount: "-40%",
    description: "Todo lo esencial para empezar a llenar tu agenda.",
    features: [
      "1 sede y 1 profesional",
      "Reservas online ilimitadas",
      "Recordatorios por email",
      "Recordatorios por WhatsApp ilimitados",
    ],
    cta: "Elegir Básico",
    featured: false,
  },
  {
    name: "Profesional",
    previousPrice: "$119.900",
    price: "$89.900",
    discount: "-25%",
    description: "Más equipo, más control y herramientas para crecer.",
    features: [
      "Hasta 2 sedes y 3 profesionales por sede (6 en total)",
      "Base de clientes y segmentación",
      "Recordatorios por WhatsApp ilimitados",
      "Reportes e histórico de servicios",
      "Sistema de caja",
      "Soporte prioritario",
    ],
    cta: "Probar Profesional",
    featured: true,
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f3f9fd] text-slate-950">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="text-xl font-black tracking-tight">Agenda Clara<span className="text-sky-500">.</span></Link>
        <nav className="flex items-center gap-3 text-sm sm:gap-6">
          <Link href="#planes" className="hidden font-semibold text-slate-700 hover:text-slate-950 sm:inline">Planes</Link>
          <Link href="/login" className="font-semibold text-slate-700 hover:text-slate-950">Iniciar sesión</Link>
          <Link href="/registro" className="rounded-full bg-slate-950 px-4 py-2.5 font-semibold text-white transition hover:bg-slate-800">Comenzar gratis</Link>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 md:grid-cols-[1.05fr_.95fr] md:pb-28 md:pt-16">
        <div className="pointer-events-none absolute -left-40 top-12 h-80 w-80 rounded-full bg-sky-200/60 blur-3xl" />
        <div className="relative">
          <p className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-sky-950">
            <Sparkles size={15} /> Tu negocio merece una agenda más fácil
          </p>
          <h1 className="mt-7 max-w-2xl text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            Más citas.<br /><span className="text-sky-600">Menos vueltas.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
            Para cualquier profesional que trabaja con citas: barberías, peluquerías, estudios de uñas y pestañas, consultorios y profesionales independientes. Tus clientes reservan en línea a cualquier hora.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/registro" className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-sky-300 px-6 font-bold text-slate-950 shadow-lg shadow-sky-200 transition hover:bg-sky-200">
              Prueba gratis por 5 días <ArrowRight size={18} />
            </Link>
            <a href="#planes" className="inline-flex items-center gap-2 font-semibold text-slate-600 hover:text-slate-950">Conocer planes <ArrowDown size={16} /></a>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Check size={16} className="text-sky-700" /> 5 días con Profesional</span>
            <span className="inline-flex items-center gap-1.5"><Check size={16} className="text-sky-700" /> Sin tarjeta de crédito</span>
          </div>
        </div>

        <div className="relative rounded-[2rem] bg-slate-950 p-5 text-white shadow-2xl shadow-sky-950/15 sm:p-7">
          <div className="absolute -right-5 -top-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-sky-300 text-slate-950 shadow-xl">
            <CalendarCheck size={34} />
          </div>
          <div className="flex items-center justify-between border-b border-white/10 pb-5 pr-16">
            <div><p className="text-sm text-slate-400">Miércoles, 16 de octubre</p><h2 className="mt-1 text-xl font-bold">Agenda de hoy</h2></div>
            <span className="rounded-lg bg-sky-300/15 px-3 py-2 text-sm font-semibold text-sky-200">Hoy</span>
          </div>
          <div className="mt-5 space-y-3">
            {[["09:00", "Corte clásico", "Carlos M."], ["10:30", "Barba y perfilado", "Juan P."], ["12:00", "Corte + barba", "Andrés R."]].map(([time, service, customer]) => (
              <div key={time} className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.06] p-4">
                <span className="text-sm font-bold text-sky-300">{time}</span><span className="h-9 w-px bg-white/10" />
                <div><p className="font-semibold">{service}</p><p className="mt-0.5 text-sm text-slate-400">{customer}</p></div>
                <span className="ml-auto h-2.5 w-2.5 rounded-full bg-sky-300" />
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-sky-300/10 p-4"><p className="text-sm text-slate-400">Citas de hoy</p><p className="mt-1 text-2xl font-black">8</p></div>
            <div className="rounded-2xl bg-white/[0.06] p-4"><p className="text-sm text-slate-400">Esta semana</p><p className="mt-1 text-2xl font-black">24</p></div>
          </div>
        </div>
      </section>

      <section className="border-y border-sky-100 bg-white/70">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-10 sm:px-8 md:grid-cols-3">
          {benefits.map(({ icon: Icon, title, text }) => (
            <article key={title} className="flex gap-4 rounded-2xl p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-800"><Icon size={22} /></div>
              <div><h2 className="font-bold">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{text}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section id="planes" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-black uppercase tracking-[.2em] text-sky-700">Precios simples</p>
          <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">Crece a tu ritmo</h2>
          <p className="mt-4 text-lg text-slate-600">Empieza con 5 días gratis del plan Profesional. Sin tarjeta, sin cobros sorpresa.</p>
        </div>
        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.name} className={`relative flex flex-col rounded-3xl p-6 sm:p-8 ${plan.featured ? "border-2 border-sky-300 bg-slate-950 text-white shadow-2xl shadow-sky-950/15 lg:-my-3 lg:py-11" : "border border-slate-200 bg-white"}`}>
              {plan.featured && <span className="absolute -top-3 left-6 rounded-full bg-sky-300 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-slate-950">Más elegido</span>}
              <h3 className="text-2xl font-black">{plan.name}</h3>
              <p className={`mt-2 min-h-12 text-sm leading-6 ${plan.featured ? "text-slate-300" : "text-slate-600"}`}>{plan.description}</p>
              <div className="mt-6">
                <div className={`flex items-center gap-2 text-sm ${plan.featured ? "text-slate-400" : "text-slate-500"}`}>
                  <span className="line-through">{plan.previousPrice}</span><span className="rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-900">{plan.discount}</span>
                </div>
                <p className="mt-1"><span className="text-4xl font-black">{plan.price}</span><span className={plan.featured ? "text-slate-300" : "text-slate-500"}>/mes</span></p>
              </div>
              <ul className="mt-7 flex-1 space-y-3">
                {plan.features.map((feature) => <li key={feature} className={`flex gap-3 text-sm leading-5 ${plan.featured ? "text-slate-200" : "text-slate-700"}`}>
                  <Check size={17} className="mt-0.5 shrink-0 text-sky-400" />{feature}
                </li>)}
              </ul>
              <Link href="/registro" className={`mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-bold transition ${plan.featured ? "bg-sky-300 text-slate-950 hover:bg-sky-200" : "bg-slate-950 text-white hover:bg-slate-800"}`}>
                {plan.cta} <ArrowRight size={17} />
              </Link>
            </article>
          ))}
          <article className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-2"><UsersRound size={20} className="text-sky-700" /><h3 className="text-2xl font-black">Empresarial</h3></div>
            <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">Una solución a la medida para negocios con varias sedes.</p>
            <p className="mt-6 text-3xl font-black">Tarifa personalizada</p>
            <ul className="mt-7 flex-1 space-y-3">
              {["Múltiples sedes y equipos avanzados", "Reportes ejecutivos y soporte prioritario", "Implementación y acompañamiento comercial"].map((feature) => (
                <li key={feature} className="flex gap-3 text-sm leading-5 text-slate-700"><Check size={17} className="mt-0.5 shrink-0 text-sky-600" />{feature}</li>
              ))}
            </ul>
            <a href="https://wa.me/573042357606?text=Hola%2C%20quiero%20conocer%20el%20plan%20Empresarial%20de%20Agenda%20Clara" target="_blank" rel="noreferrer" className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-slate-950 px-4 font-bold transition hover:bg-sky-100">
              Hablar con ventas <ArrowRight size={17} />
            </a>
          </article>
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">Precios mensuales en pesos colombianos (COP). Prueba de 5 días sin tarjeta de crédito.</p>
      </section>

      <section className="bg-sky-300 px-5 py-14 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 text-center sm:flex-row sm:text-left">
          <div><p className="text-sm font-black uppercase tracking-widest text-sky-950">Tu agenda te espera</p><h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Pruébalo gratis. Sin tarjeta.</h2></div>
          <Link href="/registro" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-950 px-5 font-bold text-white transition hover:bg-slate-800">Empezar mis 5 días gratis <ArrowRight size={18} /></Link>
        </div>
      </section>
    </main>
  );
}
