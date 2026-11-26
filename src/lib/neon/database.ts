import "server-only";
import { neon } from "@neondatabase/serverless";

type Access = { userId: string } | "service" | "auth-directory";

let database: ReturnType<typeof neon<false, false>> | undefined;

export async function query<T>(access: Access, sql: string, parameters: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta configurar DATABASE_URL.");
  database ??= neon(url);
  const connection = database;

  // This connection belongs to the server. Application queries must run under
  // the appropriate DB role, with request identity scoped to the transaction.
  if (access === "auth-directory") return await connection.query(sql, parameters) as T[];

  const role = access === "service" ? "service_role" : "authenticated";
  const claims = access === "service" ? {} : { sub: access.userId };
  const [, , rows] = await connection.transaction([
    connection.query(`set local role ${role}`),
    connection.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]),
    connection.query(sql, parameters),
  ]);
  return rows as T[];
}

export type DatabaseAccess = Access;
