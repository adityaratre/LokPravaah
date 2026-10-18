# LokPravaah

A React + Vite civic reporting platform backed by Supabase, with worker/referral workflows, Blog & Updates, and a voluntary donation page.

## Donation page

Open **Donate** in the public navigation or click **Support the project** on the homepage. The donation page supports custom rupee amounts, privacy-conscious donor participation, a live-refreshing verified leaderboard/recent feed, campaign progress, and admin-managed presentation settings. Payment totals only count signed server-webhook confirmations.

Read [`DONATIONS_SETUP.md`](DONATIONS_SETUP.md) before accepting public payments. For the no-card Cloudflare Workers + Supabase donation gateway, follow [`CLOUDFLARE_UPI_SETUP.md`](CLOUDFLARE_UPI_SETUP.md). This is a donation-focused replacement for the public checkout path; it does not port every legacy YouPI PG service. Deploy one gateway path at a time, set a real receiving UPI account, pair the receiving-account Android observer, and verify the signed Supabase webhook before enabling real donations.

## Existing Supabase setup

For an existing project, run `supabase/lokpravaah_final_worker_blog_patch.sql` only if the worker/referral and `site_posts` Blog & Updates migration has not already been applied, then run `supabase/lokpravaah_donations.sql` in the same Supabase project's SQL Editor. Do not rerun the foundation migrations merely to fix an existing production table.

For a fresh Supabase project, apply `schema.sql`, `v4_platform_migration.sql`, `lokpravaah_ai_giftcard_repair.sql`, `lokpravaah_final_worker_blog_patch.sql`, then `lokpravaah_donations.sql`, in that order.

## Worker and Blog features

- Approved workers have the restricted `worker` role and can accept/route assigned reports, update status, and submit notes plus private photo/video evidence.
- Admins can directly assign users to Worker; admin privileges are separate.
- Blog & Updates uses `public.site_posts`; super administrators manage publish/edit/delete permissions.
- High-impact donation/payment settings requested by a regular admin stay pending until a super administrator approves them.

## Validation

The Cloudflare Worker JavaScript syntax and 8 local route/security-path tests pass. The full Worker bundle check relies on Wrangler in GitHub Actions. This package is not connected to your live Supabase database or Cloudflare account; the SQL migration has not been executed on your database and real bank payment verification has not been end-to-end tested.
