import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getAuth } from "./auth";
import { dataClient } from "./queries";

const getUser = cache(async () => {
  await connection();
  const { data: session, error } = await getAuth().getSession();
  const account = session?.user;
  const user = account?.emailVerified ? {
    id: account.id,
    email: account.email,
    email_confirmed_at: account.updatedAt.toString(),
  } : null;
  return { data: { user }, error };
});

export async function createClient() {
  const session = await getUser();
  return {
    ...dataClient(session.data.user ? { userId: session.data.user.id } : null),
    auth: { getUser: async () => session },
  };
}
