import { z } from "zod";
import { isValidTimeZone } from "@/lib/validation/timezone";

export const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

export const businessTypes = [
  "barbería",
  "peluquería",
  "manicura",
  "lashista",
  "consultorio",
  "profesional_independiente",
  "otro",
] as const;

export const businessOnboardingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Usa letras minúsculas, números y guiones."),
  type: z.enum(businessTypes),
  phone: z.string().trim().max(30).optional(),
  whatsapp: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  timezone: z.string().min(1).max(80).refine(isValidTimeZone, "Selecciona una zona horaria válida."),
  staffName: z.string().trim().min(2).max(120),
  staffEmail: z.email("Ingresa el correo electrónico del profesional."),
  serviceName: z.string().trim().min(2).max(120),
  serviceDuration: z.coerce.number().int().min(5).max(1440),
  servicePrice: z.coerce.number().int().min(0),
  hours: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    open_time: z.string().regex(/^\d{2}:\d{2}$/),
    close_time: z.string().regex(/^\d{2}:\d{2}$/),
    is_closed: z.boolean(),
  })).length(7),
});
