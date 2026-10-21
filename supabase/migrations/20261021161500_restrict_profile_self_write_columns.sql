-- Profiles contain server-managed fields such as impact_points and timestamps.
-- A row-level "own profile" policy alone still lets a user change every column
-- they have table UPDATE privileges for. Restrict self-service writes to profile
-- fields that the UI actually edits.
REVOKE INSERT, UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

GRANT INSERT (
  id,
  display_name,
  avatar_url,
  preferred_language,
  phone,
  city,
  ward,
  account_type,
  preferred_service
) ON TABLE public.profiles TO authenticated;

GRANT UPDATE (
  id,
  display_name,
  avatar_url,
  preferred_language,
  phone,
  city,
  ward,
  account_type,
  preferred_service
) ON TABLE public.profiles TO authenticated;
