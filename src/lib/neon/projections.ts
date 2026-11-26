type NullableTextColumns = "phone" | "whatsapp" | "address" | "logo_url" | "email" | "notes" | "note"
  | "trial_ends_at" | "current_period_ends_at" | "open_time" | "close_time" | "used_at" | "decision"
  | "provider_message_id" | "last_error" | "reason";
type NumericColumns = "duration_minutes" | "price_cop" | "amount_cop" | "amount_in_cents" | "weekday" | "attempts";
type NullableNumericColumns = "enterprise_staff_limit" | "enterprise_location_limit"
  | "location_limit_override" | "staff_limit_override" | "monthly_price_cop" | "regular_price_cop";
type BooleanColumns = "is_active" | "is_closed" | "customer_whatsapp_consent";
type NullableBooleanColumns = "cash_enabled" | "reports_enabled" | "customer_history_enabled";

type Column<Name> = Name extends NumericColumns ? number
  : Name extends NullableNumericColumns ? number | null
  : Name extends BooleanColumns ? boolean
  : Name extends NullableBooleanColumns ? boolean | null
  : Name extends NullableTextColumns ? string | null
  : Name extends "font_family" ? "sans" | "serif" | "mono"
  : Name extends "benefits" ? unknown
  : string;

type Field<FieldName extends string> = FieldName extends `${infer Name}(${infer Nested})`
  ? { [K in Name]: K extends "appointment_services" ? Projection<Nested>[] : Projection<Nested> | null }
  : { [K in FieldName]: Column<K> };

type Parse<
  Input extends string, Token extends string = "", Depth extends 1[] = [], Fields = unknown,
> = Input extends `${infer Character}${infer Rest}`
  ? Character extends " "
    ? Parse<Rest, Token, Depth, Fields>
    : Character extends "("
      ? Parse<Rest, `${Token}(`, [1, ...Depth], Fields>
      : Character extends ")"
        ? Parse<Rest, `${Token})`, Depth extends [1, ...infer Tail extends 1[]] ? Tail : [], Fields>
        : Character extends "," ? Depth extends [] ? Parse<Rest, "", [], Fields & Field<Token>>
          : Parse<Rest, `${Token},`, Depth, Fields>
        : Parse<Rest, `${Token}${Character}`, Depth, Fields>
  : Fields & Field<Token>;

export type Projection<Input extends string> = { [K in keyof Parse<Input>]: Parse<Input>[K] };

const relations: Record<string, readonly [foreignKey: string, parentKey: string, many?: boolean]> = {
  "appointments.customers": ["id", "customer_id"],
  "appointments.services": ["id", "service_id"],
  "appointments.staff": ["id", "staff_id"],
  "appointments.appointment_services": ["appointment_id", "id", true],
  "appointment_services.services": ["id", "service_id"],
  "appointment_payments.appointments": ["id", "appointment_id"],
  "blocked_times.staff": ["id", "staff_id"],
};

export function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Identificador SQL inválido.");
  return `"${value}"`;
}

function splitProjection(selection: string) {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selection.length; index++) {
    const character = selection[index];
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (character === "," && depth === 0) {
      fields.push(selection.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(selection.slice(start).trim());
  return fields;
}

export function project(table: string, selection: string, level = 0): string {
  const parent = `r${level}`;
  const child = `r${level + 1}`;
  return splitProjection(selection).map((field) => {
    const nested = /^([a-z_][a-z0-9_]*)\((.+)\)$/.exec(field);
    if (!nested) return `${parent}.${identifier(field)}`;

    const [, name, columns] = nested;
    const relation = relations[`${table}.${name}`];
    if (!relation) throw new Error("Relación SQL no configurada.");
    const [foreignKey, parentKey, many] = relation;
    const source = `select ${project(name, columns, level + 1)} from public.${identifier(name)} ${child}
      where ${child}.${identifier(foreignKey)} = ${parent}.${identifier(parentKey)}`;
    const value = many ? "coalesce(jsonb_agg(to_jsonb(rel)), '[]'::jsonb)" : "to_jsonb(rel)";
    return `(select ${value} from (${source}) rel) as ${identifier(name)}`;
  }).join(", ");
}
