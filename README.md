# LokPravaah

A React + Vite civic reporting platform backed by Supabase, with worker/referral workflows, Blog & Updates, and a voluntary donation page.

## Donation page

Open **Donate** in the public navigation or click **Support the project** on the homepage. The donation page supports custom rupee amounts, privacy-conscious donor participation, a live-refreshing verified leaderboard/recent feed, campaign progress, and admin-managed presentation settings. Payment totals only count signed server-webhook confirmations.

Read [`DONATIONS_SETUP.md`](DONATIONS_SETUP.md) before accepting public payments. The Node UPI payment service lives at `services/lokpravaah-upi/`; it must be deployed separately from the static Vite frontend and configured with a real receiving UPI account, an allowlisted site origin and a signed Supabase webhook.

## Existing Supabase setup

For an existing project, run `supabase/lokpravaah_final_worker_blog_patch.sql` only if the worker/referral and `site_posts` Blog & Updates migration has not already been applied, then run `supabase/lokpravaah_donations.sql` in the same Supabase project's SQL Editor. Do not rerun the foundation migrations merely to fix an existing production table.

For a fresh Supabase project, apply `schema.sql`, `v4_platform_migration.sql`, `lokpravaah_ai_giftcard_repair.sql`, `lokpravaah_final_worker_blog_patch.sql`, then `lokpravaah_donations.sql`, in that order.

## Worker and Blog features

- Approved workers have the restricted `worker` role and can accept/route assigned reports, update status, and submit notes plus private photo/video evidence.
- Admins can directly assign users to Worker; admin privileges are separate.
- Blog & Updates uses `public.site_posts`; super administrators manage publish/edit/delete permissions.
- High-impact donation/payment settings requested by a regular admin stay pending until a super administrator approves them.

## Validation

Source syntax, gateway JavaScript parsing and package/archive checks are run for this release. This package is not connected to your live Supabase database, real receiving UPI account, Cloudflare routes or payment provider, so live checkout and a dependency-backed production build must still be verified in the target environment.
