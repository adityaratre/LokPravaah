# Deploy LokPravaah Janwatch AI from GitHub — No local terminal needed

This GitHub Actions workflow deploys **only** `janwatch-ai` to Supabase. GitHub runs the deployment for you on its hosted runner; you do not need to open a terminal on your computer.

## 1. Add the workflow to the GitHub repository

Make sure the repository contains the extracted project files, including `supabase/functions/janwatch-ai/index.ts` (not only a ZIP file).

Add this file at exactly:

`.github/workflows/deploy-supabase-functions.yml`

The workflow is included in this project ZIP. If uploading files through the GitHub website, use **Add file → Create new file** and create the same path, then paste the workflow contents from this ZIP. Commit the file to `main` or `master`.

## 2. Add two GitHub Actions secrets

In GitHub open **Repository → Settings → Secrets and variables → Actions → New repository secret** and add:

- `SUPABASE_ACCESS_TOKEN`: create a Personal Access Token from your Supabase account's Access Tokens page. Keep it secret.
- `SUPABASE_PROJECT_ID`: the Project Reference ID shown in your Supabase project URL / project settings.

Do not put either value in source code or commit it to the repository.

## 3. Add AI provider secrets in Supabase (separate from GitHub secrets)

Open **Supabase Dashboard → your project → Edge Functions → Secrets** and add:

- `OPENROUTER_API_KEY`: your OpenRouter key
- `OPENROUTER_MODELS`: optional comma-separated model IDs; `openrouter/free` is already used as a safe fallback by this function
- `GEMINI_API_KEY`: your Gemini key

The function defaults Gemini backup to enabled. Optional tuning variables used by the function include `GEMINI_MODEL`, `AI_ENABLE_GEMINI_BACKUP`, `AI_ALLOW_PAID_OPENROUTER_MODELS`, `GROQ_API_KEY`, `GROQ_MODEL`, and `AI_ENABLE_GROQ_BACKUP`. Keep provider API keys only in Supabase secrets, never in browser code or GitHub source.

## 4. Confirm deployment in GitHub

Open the repository's **Actions** tab. A push to `main` / `master` that includes the workflow will start the job, or open **Actions → Deploy Janwatch AI Edge Function → Run workflow** to start it manually. The workflow runs `supabase functions deploy janwatch-ai` on GitHub-hosted infrastructure.

If the job fails, open the failed run and read the red error step. Common causes are missing GitHub secrets, a wrong project reference, the source files being nested differently, or a missing/invalid Supabase token.

## Important

This workflow deploys the Supabase Edge Function only. Your frontend hosting provider (for example, Vercel/Netlify) separately builds and deploys the website. SQL migrations are also not executed by this workflow; run approved SQL scripts through Supabase SQL Editor when needed.
