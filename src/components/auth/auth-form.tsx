"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmEmailAction, signInAction, signUpAction, type ActionState } from "@/app/actions/auth";

type AuthFormProps = { mode: "login" | "register" };
const initialState: ActionState = {};

export function AuthForm({ mode }: AuthFormProps) {
  const action = mode === "login" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const isLogin = mode === "login";
  if (state.verificationEmail) return <ConfirmEmailForm email={state.verificationEmail} />;

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <label className="block text-sm font-medium text-slate-700">
        Correo electrónico
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          minLength={8}
          required
          className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
        />
        {!isLogin && <span className="mt-1 block text-xs text-slate-500">Mínimo 8 caracteres.</span>}
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{state.success}</p>}
      <button
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-slate-950 px-4 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "Un momento..." : isLogin ? "Iniciar sesión" : "Crear cuenta"}
      </button>
      <p className="text-center text-sm text-slate-600">
        {isLogin ? "¿Primera vez aquí?" : "¿Ya tienes una cuenta?"}{" "}
        <Link className="font-semibold text-amber-700 hover:text-amber-800" href={isLogin ? "/registro" : "/login"}>
          {isLogin ? "Crea tu cuenta" : "Inicia sesión"}
        </Link>
      </p>
    </form>
  );
}

function ConfirmEmailForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <h2 className="text-xl font-semibold text-slate-950">Confirma tu correo</h2>
      <p className="text-sm text-slate-600">Escribe el código de seis dígitos enviado a {email}.</p>
      <input name="email" type="hidden" value={email} />
      <label className="block text-sm font-medium text-slate-700">
        Código de verificación
        <input
          name="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          required
          className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/50"
        />
      </label>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{state.success}</p>}
      <button
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-slate-950 px-4 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "Un momento..." : "Confirmar correo"}
      </button>
      <button
        type="submit"
        name="intent"
        value="resend"
        formNoValidate
        disabled={pending}
        className="block min-h-10 w-full text-sm font-semibold text-amber-700 hover:text-amber-800 disabled:opacity-60"
      >
        Reenviar código
      </button>
    </form>
  );
}
