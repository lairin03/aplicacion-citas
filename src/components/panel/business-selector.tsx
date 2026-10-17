"use client";

import { selectBusinessAction } from "@/app/actions/panel";

type BusinessOption = { id: string; name: string };

export function BusinessSelector({
  businesses,
  activeBusinessId,
  id,
  className,
}: {
  businesses: BusinessOption[];
  activeBusinessId: string;
  id: string;
  className: string;
}) {
  return (
    <form action={selectBusinessAction} className={id.endsWith("-mobile") ? "px-4 pb-3" : "mt-6"}>
      <label htmlFor={id} className={id.endsWith("-mobile") ? "sr-only" : "text-xs font-semibold uppercase tracking-wider text-slate-400"}>
        Sede activa
      </label>
      <select
        id={id}
        name="businessId"
        defaultValue={activeBusinessId}
        className={className}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
      </select>
    </form>
  );
}
