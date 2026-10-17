import "server-only";

import { cookies } from "next/headers";

export async function selectCurrentBusiness<T extends { id: string }>(businesses: T[]) {
  if (!businesses.length) return null;
  const cookieStore = await cookies();
  const selectedId = cookieStore.get("active_business_id")?.value;
  return businesses.find((business) => business.id === selectedId) ?? businesses[0];
}
