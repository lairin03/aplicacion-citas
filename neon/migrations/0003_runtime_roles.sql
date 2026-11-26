-- Neon grants the project owner ADMIN OPTION on these roles by default.
-- The application also needs SET ROLE to use their narrower RLS permissions.
begin;

grant authenticated, service_role to neondb_owner with inherit false, set true;

commit;
