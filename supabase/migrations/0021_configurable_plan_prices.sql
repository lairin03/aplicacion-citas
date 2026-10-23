alter table public.plan_feature_catalog
  add column monthly_price_cop integer,
  add column regular_price_cop integer;

update public.plan_feature_catalog
set monthly_price_cop = 29900,
    regular_price_cop = 49900
where plan = 'basic';

update public.plan_feature_catalog
set monthly_price_cop = 89900,
    regular_price_cop = 119900
where plan = 'professional';

alter table public.plan_feature_catalog
  add constraint plan_feature_catalog_price_valid
  check (
    (
      plan = 'enterprise'
      and monthly_price_cop is null
      and regular_price_cop is null
    )
    or (
      plan in ('basic', 'professional')
      and monthly_price_cop between 1000 and 1000000000
      and (regular_price_cop is null or (
        regular_price_cop between monthly_price_cop and 1000000000
      ))
    )
  );

notify pgrst, 'reload schema';
