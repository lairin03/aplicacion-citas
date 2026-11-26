"use server";

import { redirect } from "next/navigation";
import { credentialsSchema } from "@/lib/validation/auth";
import { getAuth } from "@/lib/neon/auth";

export type ActionState = { error?: string; success?: string };

function authErrorMessage(error: { code?: string; status?: number }) {
  switch (error.code) {
    case "EMAIL_NOT_VERIFIED":
      return "Confirma tu correo electrónico y vuelve a iniciar sesión.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "El correo o la contraseña no coinciden con una cuenta registrada.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Ya existe una cuenta con ese correo. Intenta iniciar sesión.";
  }
  if (error.status === 429) return "Se hicieron demasiados intentos. Espera un momento e inténtalo de nuevo.";
  return "No se pudo completar la autenticación. Intenta nuevamente.";
}

export async function signInAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos ingresados." };

  try {
    const { error } = await getAuth().signIn.email(parsed.data);
    if (error) return { error: authErrorMessage(error) };
  } catch {
    return { error: "No se pudo conectar con el servicio de autenticación. Intenta nuevamente." };
  }

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
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos ingresados." };

  try {
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw new Error("Falta configurar APP_URL.");
    const { error } = await getAuth().signUp.email({
      ...parsed.data,
      name: parsed.data.email.split("@")[0],
      callbackURL: new URL("/login", appUrl).href,
    });
    if (error) return { error: authErrorMessage(error) };
  } catch {
    return { error: "No se pudo conectar con el servicio de autenticación. Intenta nuevamente." };
  }

  return { success: "Revisa tu correo para confirmar la cuenta y luego inicia sesión." };
}

export async function signOutAction() {
  const { error } = await getAuth().signOut();
  if (error) throw new Error("No fue posible cerrar la sesión.");
  redirect("/login");
}
