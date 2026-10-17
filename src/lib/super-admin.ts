import "server-only";

export const SUPER_ADMIN_EMAIL = "delaranslairin9@gmail.com";

export function isSuperAdmin(email: string | undefined) {
  return email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isConfirmedSuperAdmin(user: {
  email?: string;
  email_confirmed_at?: string;
} | null | undefined) {
  return isSuperAdmin(user?.email) && !!user?.email_confirmed_at;
}
