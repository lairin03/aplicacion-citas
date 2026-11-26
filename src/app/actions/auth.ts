"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { credentialsSchema } from "@/lib/validation/auth";
import { getAuth } from "@/lib/neon/auth";

export type ActionState = { error?: string; success?: string; verificationEmail?: string };

function authErrorMessage(error: { code?: string; status?: number }) {
  switch (error.code) {
    case "invalid_credentials":
      return "El correo o la contraseña no coinciden con una cuenta registrada.";
    case "user_already_exists":
      return "Ya existe una cuenta con ese correo. Intenta iniciar sesión.";
    case "weak_password":
      return "Elige una contraseña de entre 8 y 128 caracteres.";
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
    if (error?.code === "email_not_confirmed") return { verificationEmail: parsed.data.email };
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
    const auth = getAuth();
    const { data, error } = await auth.signUp.email({
      ...parsed.data,
      name: parsed.data.email.split("@")[0],
    });
    if (error) return { error: authErrorMessage(error) };
    if (!data?.user.emailVerified) {
      const { error: deliveryError } = await auth.emailOtp.sendVerificationOtp({
        email: parsed.data.email,
        type: "email-verification",
      });
      return {
        verificationEmail: parsed.data.email,
        error: deliveryError ? "No se pudo enviar el código. Pulsa Reenviar código para intentarlo de nuevo." : undefined,
      };
    }
  } catch {
    return { error: "No se pudo conectar con el servicio de autenticación. Intenta nuevamente." };
  }

  redirect("/login?correo=confirmado");
}

export async function confirmEmailAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = z.email().safeParse(formData.get("email"));
  if (!email.success) return { error: "El correo electrónico no es válido." };
  const resend = formData.get("intent") === "resend";
  const otp = String(formData.get("otp") ?? "").trim();
  if (!resend && !/^\d{6}$/.test(otp)) return { error: "Escribe el código de seis dígitos." };

  try {
    const auth = getAuth();
    if (resend) {
      const { error } = await auth.emailOtp.sendVerificationOtp({
        email: email.data,
        type: "email-verification",
      });
      if (error) return { error: authErrorMessage(error) };
      return { success: "Si tu cuenta está pendiente de verificación, recibirás un nuevo código." };
    }

    const { error } = await auth.emailOtp.verifyEmail({ email: email.data, otp });
    if (error?.status === 429) return { error: authErrorMessage(error) };
    if (error) return { error: "El código no es válido o venció. Puedes pedir otro." };
  } catch {
    return { error: "No se pudo conectar con el servicio de autenticación. Intenta nuevamente." };
  }

  redirect("/login?correo=confirmado");
}

export async function signOutAction() {
  const { error } = await getAuth().signOut();
  if (error) throw new Error("No fue posible cerrar la sesión.");
  redirect("/login");
}
