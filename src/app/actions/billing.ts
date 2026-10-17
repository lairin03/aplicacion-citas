"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isConfirmedSuperAdmin } from "@/lib/super-admin";

const plans = {
  basic: { amountInCents: 2_990_000 },
  professional: { amountInCents: 8_990_000 },
} as const;

export async function startWompiCheckoutAction(formData: FormData) {
  const parsedPlan = z.enum(["basic", "professional"]).safeParse(formData.get("plan"));
  if (!parsedPlan.success) throw new Error("El plan seleccionado no es válido.");

  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  const eventsSecret = process.env.WOMPI_EVENTS_SECRET;
  const appUrl = process.env.APP_URL;
  if (!publicKey || !integritySecret || !eventsSecret || !appUrl) {
    throw new Error("Wompi aún no está configurado para recibir pagos de forma segura.");
  }

  let returnUrl: URL;
  try {
    returnUrl = new URL("/planes?payment=returned", appUrl);
  } catch {
    throw new Error("La URL pública de la aplicación no está configurada correctamente.");
  }
  if (process.env.NODE_ENV === "production" && returnUrl.protocol !== "https:") {
    throw new Error("APP_URL debe usar HTTPS en producción.");
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");
  if (isConfirmedSuperAdmin(user)) redirect("/admin");
  if (!user.email) throw new Error("La cuenta no tiene un correo para asociar al pago.");

  const { data: subscription, error: subscriptionError } = await supabase
    .from("business_subscriptions")
    .select("owner_id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (subscriptionError) throw new Error("No se pudo validar la cuenta para iniciar el pago.");
  if (!subscription) redirect("/onboarding");

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (businessError) throw new Error("No se pudo validar el negocio para iniciar el pago.");
  if (!business) redirect("/onboarding");

  const plan = parsedPlan.data;
  const amountInCents = plans[plan].amountInCents;
  const reference = `AC${randomBytes(16).toString("hex")}`;
  const admin = createAdminClient();
  const { error: intentError } = await admin.from("billing_payment_intents").insert({
    reference,
    owner_id: user.id,
    plan,
    amount_in_cents: amountInCents,
    currency: "COP",
  });
  if (intentError) {
    console.error("No se pudo crear la intención de pago de Wompi.", {
      code: intentError.code,
      message: intentError.message,
    });
    throw new Error("No se pudo iniciar el pago. Intenta nuevamente.");
  }

  const integritySignature = createHash("sha256")
    .update(`${reference}${amountInCents}COP${integritySecret}`)
    .digest("hex");
  const checkoutUrl = new URL("https://checkout.wompi.co/p/");
  checkoutUrl.searchParams.set("public-key", publicKey);
  checkoutUrl.searchParams.set("currency", "COP");
  checkoutUrl.searchParams.set("amount-in-cents", String(amountInCents));
  checkoutUrl.searchParams.set("reference", reference);
  checkoutUrl.searchParams.set("signature:integrity", integritySignature);
  checkoutUrl.searchParams.set("redirect-url", returnUrl.toString());
  checkoutUrl.searchParams.set("customer-data:email", user.email ?? "");

  redirect(checkoutUrl.toString());
}
