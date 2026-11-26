import "server-only";
import { query } from "./database";
import { dataClient } from "./queries";

type DirectoryUser = { id: string; email: string };

export function createAdminClient() {
  return {
    ...dataClient("service"),
    auth: {
      admin: {
        async listUsers({ page, perPage }: { page: number; perPage: number }) {
          try {
            const users = await query<DirectoryUser>("auth-directory",
              'select id, email from neon_auth."user" order by id limit $1 offset $2',
              [perPage, (page - 1) * perPage],
            );
            return { data: { users }, error: null };
          } catch (error) {
            return { data: { users: [] }, error };
          }
        },
        async getUserById(id: string) {
          try {
            const [user] = await query<DirectoryUser>("auth-directory",
              'select id, email from neon_auth."user" where id = $1', [id],
            );
            return { data: { user: user ?? null }, error: null };
          } catch (error) {
            return { data: { user: null }, error };
          }
        },
      },
    },
  };
}
