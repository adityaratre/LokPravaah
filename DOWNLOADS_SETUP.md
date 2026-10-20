# LokPravaah Download Centre — Setup

- Public downloads render on the public Welcome page only; they are not part of the signed-in dashboard.
- Super Admin → Admin Console → Downloads provides upload, publish/unpublish and delete controls.
- Files are stored in the dedicated public Supabase Storage bucket `app-downloads`; metadata lives in `public.download_files`.
- The bucket is limited to 500 MB per file. Only users with `public.user_roles.role = 'super_admin'` can upload, edit or delete files. Only published rows are shown on the public page.

## Database

The migration `supabase/lokpravaah_downloads.sql` has been applied to the active Supabase project for this site. For a fresh environment, run the entire migration against the same Supabase project used by the app.

## Verify

1. Sign in using the super-admin account.
2. Open Admin Console → Downloads.
3. Upload a small test file and choose Publish immediately.
4. Sign out or open the public Welcome page in a private browser and confirm the published file appears and downloads.
5. Test Hide/Publish and Delete in the admin console.
