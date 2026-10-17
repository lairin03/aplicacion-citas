import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="text-sm font-semibold text-amber-700">Agenda Clara</Link>
      <h1 className="mt-5 text-3xl font-bold tracking-tight">Qué bueno verte</h1>
      <p className="mt-2 text-slate-600">Ingresa para administrar las citas de tu negocio.</p>
      <AuthForm mode="login" />
    </main>
  );
}
