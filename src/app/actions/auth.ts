"use server";

import { redirect } from "next/navigation";
import { credentialsSchema } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; success?: string };

function getSupabaseConfigErrorMessage() {
  return "Falta configurar Supabase. Copia .env.example a .env.local y agrega NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.";
}

function getAuthErrorMessage(error: { code?: string; status?: number; message?: string }) {
  if (error.code === "email_not_confirmed") {
    return "Confirma tu correo electrónico desde el enlace que te envió Supabase y vuelve a iniciar sesión.";
  }

  if (
    error.code === "invalid_api_key"
    || error.message?.toLowerCase().includes("invalid api key")
  ) {
    return "La clave pública de Supabase no es válida para esta URL. Revisa que ambas pertenezcan al mismo proyecto.";
  }

  if (error.code === "invalid_credentials") {
    return "El correo o la contraseña no coinciden con una cuenta registrada. Si aún no tienes cuenta, regístrate primero.";
  }

  if (error.status === 429) {
    return "Se hicieron demasiados intentos. Espera un momento e inténtalo de nuevo.";
  }

  return "No se pudo completar la autenticación con Supabase. Revisa la configuración del proyecto e inténtalo de nuevo.";
}

export async function signInAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos ingresados." };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { error: getSupabaseConfigErrorMessage() };
  }

  let error;
  try {
    ({ error } = await supabase.auth.signInWithPassword(parsed.data));
  } catch {
    return { error: "No se pudo conectar con Supabase. Verifica tu conexión y las variables de entorno, y vuelve a intentarlo." };
  }

  if (error) return { error: getAuthErrorMessage(error) };

  redirect("/panel");
}

export async function signUpAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos ingresados." };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { error: getSupabaseConfigErrorMessage() };
  }

  let data;
  let error;
  try {
    ({ data, error } = await supabase.auth.signUp(parsed.data));
  } catch {
    return { error: "No se pudo conectar con Supabase. Verifica tu conexión y las variables de entorno, y vuelve a intentarlo." };
  }

  if (error) return { error: getAuthErrorMessage(error) };
  if (!data.session) {
    return { success: "Cuenta creada. Confirma tu correo y luego inicia sesión para continuar." };
  }

  redirect("/onboarding");
}

export async function signOutAction() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("No fue posible cerrar la sesión.");
  redirect("/login");
}
