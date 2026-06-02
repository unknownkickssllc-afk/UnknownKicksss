# Supabase setup — Unknown Kicks

Project: **https://fepxpoystmqllibfmgie.supabase.co**

## Step 1 — Create tables

1. Open [SQL Editor](https://supabase.com/dashboard/project/fepxpoystmqllibfmgie/sql/new)
2. Copy the entire file `supabase/schema.sql`
3. Click **Run**

## Step 2 — API keys in `.env`

From **Project Settings → API**:

```env
SUPABASE_URL=https://fepxpoystmqllibfmgie.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste service_role key here>
```

Use the **service_role** key on the server only (never in the browser).

## Step 3 — Seed products

```bash
npm run seed
```

This loads all folders under `products/` (1–10) with images and hover swaps (`image-hover.png`, etc.).

## Verify

```bash
npm start
```

Visit http://localhost:3000/api/health — should show `"database": "supabase"` and product count `10`.
