import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/neon/auth";

export function proxy(request: NextRequest) {
  return getAuth().middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/panel/:path*", "/onboarding"],
};
