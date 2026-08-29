# Ledgerline

Bank & ledger reconciliation, close checklists, and audit trails for mid-market finance teams.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage) · Vercel

---

## What's built so far (v1 foundation)

- Full project scaffold, design tokens, and core UI primitives (Button, Input, Badge, Table, Modal, empty/loading states)
- Database schema + Row-Level Security policies for the full data model (`supabase/migrations/0001_init.sql`)
- Auth flow: signup, login, logout, auto-provisioning of an organization + owner role on signup
- Role/permission system matching the 5-role model: Owner, Admin, Controller, Accountant, Auditor
- Authenticated app shell: sidebar (permission-aware nav), topbar, dashboard page

**Not yet built** (next up, per the phased roadmap): reconciliation matching workspace, Plaid/QuickBooks integrations, close checklist UI, journal entry screens, settings pages, audit log viewer. See the architecture proposal doc for the full route map.

---

## Getting started locally

### 1. Prerequisites
- Node.js 20+
- A Supabase account ([supabase.com](https://supabase.com)) — free tier is fine for the pilot
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm install -g supabase`)

### 2. Install dependencies
```bash
npm install
```

### 3. Set up Supabase
```bash
# Create a new Supabase project at supabase.com/dashboard, then:
supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations/0001_init.sql
npm run db:types          # generates types/database.ts from your real schema
```

### 4. Environment variables
```bash
cp .env.example .env.local
```
Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase project settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — same page, **never** expose this to the client or commit it
- Plaid and QuickBooks keys can stay blank until those integrations are built

### 5. Run it
```bash
npm run dev
```
Visit `http://localhost:3000` → `/signup` to create your first organization (you'll be the Owner).

---

## Project structure

See the architecture proposal doc for the full breakdown. Short version:
- `app/(marketing)` — public pages
- `app/(auth)` — login/signup
- `app/(app)` — the authenticated product, org-scoped
- `components/ui` — design-system primitives, reused everywhere
- `lib/actions` — Server Actions, grouped by domain
- `lib/permissions.ts` — the role/permission model (mirrors the RLS policies)
- `supabase/migrations` — schema + RLS, source of truth for the database

## Security notes for the pilot

- Every table is protected by Row-Level Security scoped to organization membership — this is enforced in Postgres, not just in the app.
- The `audit_log` table is insert-only at the database level; no update or delete policy exists for it, by design.
- `lib/supabase/admin.ts` bypasses RLS and must only be used in webhook handlers and background jobs — never in code that runs on behalf of a signed-in user.
- Before putting real pilot financial data in, make sure `.env.local` is never committed (already covered by `.gitignore`) and that your Supabase project's service role key is only ever set as a Vercel server-side environment variable.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add the same environment variables from `.env.local` in Vercel's project settings (Production + Preview).
4. Deploy. Vercel will run `npm run build` automatically.
