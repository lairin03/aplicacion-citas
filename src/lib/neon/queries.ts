import "server-only";
import { query, type DatabaseAccess } from "./database";
import { identifier, project, type Projection } from "./projections";

type ApplicationAccess = Exclude<DatabaseAccess, "auth-directory">;
type DataError = Error & { code?: string; details?: string; detail?: string; hint?: string };
type RowValues = Record<string, unknown>;
type Statement = "select" | "insert" | "upsert" | "update" | "delete";
type Predicate = (bind: (value: unknown) => string) => string;
type Result<Data> =
  | { data: Data; error: null; count: number | null }
  | { data: null; error: DataError; count: null };

const primaryKey: Record<string, string> = {
  business_hours: "business_id,weekday",
  plan_feature_catalog: "plan",
  appointment_whatsapp_deliveries: "appointment_id",
};

function asError(error: unknown): DataError {
  return error instanceof Error ? error : new Error(String(error));
}

export class TableQuery<Row = never> implements PromiseLike<Result<Row[]>> {
  private operation: Statement = "select";
  private selection: string | undefined;
  private countOnly = false;
  private values: RowValues[] = [];
  private conflict: string | undefined;
  private predicates: Predicate[] = [];
  private orders: string[] = [];
  private rowLimit: number | undefined;

  constructor(private access: ApplicationAccess | null, private table: string) {}

  select<Selection extends string>(
    columns: Selection,
    options?: { count: "exact"; head: true },
  ): TableQuery<Projection<Selection>> {
    this.selection = columns;
    this.countOnly = !!options?.head;
    return this as unknown as TableQuery<Projection<Selection>>;
  }

  insert(values: RowValues) {
    this.operation = "insert";
    this.values = [values];
    return this;
  }

  upsert(values: RowValues | RowValues[], options?: { onConflict: string }) {
    this.operation = "upsert";
    this.values = Array.isArray(values) ? values : [values];
    this.conflict = options?.onConflict ?? primaryKey[this.table];
    return this;
  }

  update(values: RowValues) {
    this.operation = "update";
    this.values = [values];
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  private compare(column: string, operator: string, value: unknown) {
    this.predicates.push((bind) => `r0.${identifier(column)} ${operator} ${bind(value)}`);
    return this;
  }

  eq(column: string, value: unknown) { return this.compare(column, "=", value); }
  neq(column: string, value: unknown) { return this.compare(column, "<>", value); }
  gt(column: string, value: unknown) { return this.compare(column, ">", value); }
  gte(column: string, value: unknown) { return this.compare(column, ">=", value); }
  lt(column: string, value: unknown) { return this.compare(column, "<", value); }
  lte(column: string, value: unknown) { return this.compare(column, "<=", value); }
  ilike(column: string, value: string) { return this.compare(column, "ilike", value); }

  notNull(column: string) {
    this.predicates.push(() => `r0.${identifier(column)} is not null`);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.predicates.push((bind) => values.length
      ? `r0.${identifier(column)} in (${values.map(bind).join(", ")})`
      : "false");
    return this;
  }

  order(column: string, options?: { ascending: boolean }) {
    this.orders.push(`r0.${identifier(column)} ${options?.ascending === false ? "desc nulls first" : "asc nulls last"}`);
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  private async execute(single: boolean): Promise<Result<Row[]>> {
    try {
      if (!this.access) throw new Error("Debes iniciar sesión.");
      const target = `public.${identifier(this.table)} as r0`;
      const parameters: unknown[] = [];
      const bind = (value: unknown) => `$${parameters.push(value)}`;
      const predicates = this.predicates.map((predicate) => predicate(bind));
      const where = predicates.length ? ` where ${predicates.join(" and ")}` : "";
      const columns = this.selection && project(this.table, this.selection);
      let statement: string;

      if (this.countOnly) {
        const [row] = await query<{ count: string }>(
          this.access, `select count(*) from ${target}${where}`, parameters,
        );
        return { data: [], count: Number(row.count), error: null };
      }

      if (this.operation === "select") {
        const orderBy = this.orders.length ? ` order by ${this.orders.join(", ")}` : "";
        const limit = this.rowLimit ?? (single ? 2 : undefined);
        statement = `select ${columns ?? "r0.*"} from ${target}${where}${orderBy}${limit === undefined ? "" : ` limit ${bind(limit)}`}`;
      } else {
        if (this.operation === "delete" || this.operation === "update") {
          if (!predicates.length) throw new Error("La operación requiere un filtro.");
          if (this.operation === "delete") {
            statement = `delete from ${target}${where}`;
          } else {
            const fields = Object.entries(this.values[0]).map(([key, value]) =>
              `${identifier(key)} = ${bind(value)}`,
            );
            statement = `update ${target} set ${fields.join(", ")}${where}`;
          }
        } else {
          if (!this.values.length) return { data: [], count: null, error: null };
          const keys = Object.keys(this.values[0]);
          const rows = this.values.map((values) => `(${keys.map((key) =>
            bind(key === "benefits" ? JSON.stringify(values[key]) : values[key]),
          ).join(", ")})`);
          statement = `insert into ${target} (${keys.map(identifier).join(", ")}) values ${rows.join(", ")}`;
          if (this.operation === "upsert") {
            if (!this.conflict) throw new Error("Falta configurar la clave de la actualización.");
            const keyFields = this.conflict.split(",");
            const updates = keys.filter((key) => !keyFields.includes(key))
              .map((key) => `${identifier(key)} = excluded.${identifier(key)}`);
            const action = updates.length ? `do update set ${updates.join(", ")}` : "do nothing";
            statement += ` on conflict (${keyFields.map(identifier).join(", ")}) ${action}`;
          }
        }
        if (!columns) {
          await query(this.access, statement, parameters);
          return { data: [], count: null, error: null };
        }
        statement += ` returning ${columns}`;
      }

      const resultSql = this.operation === "select"
        ? `select to_jsonb(result) as value from (${statement}) result`
        : `with changed as (${statement}) select to_jsonb(changed) as value from changed`;
      const rows = await query<{ value: Row }>(this.access, resultSql, parameters);
      return { data: rows.map((row) => row.value), count: null, error: null };
    } catch (error) {
      return { data: null, count: null, error: asError(error) };
    }
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    const result = await this.execute(true);
    if (result.error) return result;
    if (result.data.length > 1) {
      return { data: null, count: null, error: new Error("Se encontró más de un resultado.") };
    }
    return { ...result, data: result.data[0] ?? null };
  }

  async single(): Promise<Result<Row>> {
    const result = await this.maybeSingle();
    if (result.error) return result;
    if (result.data === null) {
      return { data: null, count: null, error: new Error("No se encontró el resultado.") };
    }
    return { ...result, data: result.data };
  }

  then<A = Result<Row[]>, B = never>(
    onfulfilled?: ((value: Result<Row[]>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ) {
    return this.execute(false).then(onfulfilled, onrejected);
  }
}

type Procedures = {
  activate_wompi_manual_payment: boolean;
  add_support_ticket_reply: null;
  consume_public_booking_rate_limit: boolean;
  create_business_for_owner_as_super_admin: string;
  create_business_onboarding: string;
  create_public_appointment: string;
  create_service_for_business: string;
  create_staff_for_business: string;
  create_support_ticket: string;
  is_business_slug_available: boolean;
  is_super_admin: boolean;
  process_appointment_decision: { appointment_id: string | null; result: string }[];
  update_staff_profile_for_business: null;
  update_support_ticket_status: null;
};

export function dataClient(access: ApplicationAccess | null) {
  return {
    from: (table: string) => new TableQuery(access, table),
    async rpc<Name extends keyof Procedures>(name: Name, args: RowValues): Promise<Result<Procedures[Name]>> {
      try {
        if (!access) throw new Error("Debes iniciar sesión.");
        const parameters: unknown[] = [];
        const namedArguments = Object.entries(args).map(([key, value]) => {
          const placeholder = `$${parameters.push(key === "p_hours" ? JSON.stringify(value) : value)}`;
          return `${identifier(key)} => ${placeholder}`;
        });
        const fn = `public.${identifier(name)}(${namedArguments.join(", ")})`;
        const returnsTable = name === "process_appointment_decision";
        const statement = returnsTable ? `select * from ${fn}` : `select ${fn} as value`;
        const rows = await query<{ value: Procedures[Name] }>(access, statement, parameters);
        const data = returnsTable ? rows as unknown as Procedures[Name] : rows[0].value;
        return { data, count: null, error: null };
      } catch (error) {
        return { data: null, count: null, error: asError(error) };
      }
    },
  };
}
