# Unknown Kicks — E-Commerce Platform

Premium streetwear store with integrated **barber referral codes**, **single-use promo validation**, and **commission tracking** built into the admin dashboard.

## Features (all phases)

### Phase 1 — Customer store
- Browse all products and filter by category
- Product pages: photos, description, price, sizes, colors, stock
- Cart: add, update quantities, remove
- Checkout: customer + shipping info, optional barber referral code
- Stripe payment (or dev checkout without Stripe)
- Order confirmation page

### Phase 2 — Admin dashboard (`/admin/`)
- Product CRUD, images, variants, inventory, sold-out flag
- Homepage hero, banners, promotional content

### Phase 3 — Order management
- View all orders with customer, shipping, products, payment status, referral code, barber

### Phase 4 — Barber referrals
- Create/edit/deactivate barbers
- Generate multiple unique single-use codes per barber
- Codes expire immediately after use

### Phase 5 — Commission tracking
- Per-barber dashboard: orders, sales, referred customers
- Unpaid/paid commissions, mark payouts, commission history

### Phase 6 — Automated order flow
On successful payment the system:
1. Creates order and saves customer
2. Reduces inventory per variant
3. Validates and marks referral code used
4. Calculates barber commission
5. Links order to barber profile
6. Surfaces order in admin + barber commission views

## Quick start

```bash
cd "Unknown Kicks"
npm install
cp .env.example .env
```

### Supabase (recommended)

1. Open [Supabase SQL Editor](https://supabase.com/dashboard/project/fepxpoystmqllibfmgie/sql/new)
2. Paste and run the full contents of `supabase/schema.sql`
3. In Supabase → **Project Settings → API**, copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)
4. Add those to `.env`, then:

```bash
npm run seed
npm start
```

Products are loaded from your local `products/` folders (images in `products/1`, `products/2`, `products/3`, etc.).

### Local SQLite (no Supabase)

Leave `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` empty in `.env`, then:

```bash
npm run seed
npm start
```

- **Store:** http://localhost:3000  
- **Admin:** http://localhost:3000/admin/  
- **Default admin code:** `0000` (set `ADMIN_PIN` in `.env` to change)  
- **Demo referral codes:** `BARBER-DEMO-001`, `BARBER-DEMO-002`, `UK-REF-TEST`

## Stripe setup

1. Add test keys to `.env`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
2. Set `BASE_URL` to your public URL
3. Stripe Dashboard → Webhooks → endpoint: `https://your-domain/api/webhooks/stripe`  
   Event: `checkout.session.completed`

Without Stripe, checkout uses **dev mode** (instant test orders).

## Project structure

```
server/           API, database, order processing
server.js         Vercel entry (exports Express app)
public/           Storefront HTML, CSS, JS, product images (Vercel CDN)
data/shop.db      SQLite database (local dev only)
```

## Deploy to GitHub + Vercel

### 1. Supabase (required for production)

Vercel cannot use local SQLite. Run `supabase/schema.sql` in your Supabase project, then set env vars on Vercel (see below).

Seed from your machine once (uses `public/products/` images):

```bash
npm run seed
```

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit — Unknown Kicks"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Never commit `.env`. Copy from `.env.example` and set secrets only in Vercel.

### 3. Import on Vercel

1. [vercel.com/new](https://vercel.com/new) → Import your GitHub repo
2. Framework: **Express** (pinned in `vercel.json`, entry point `server.js`). Keep the root directory at the repository root and leave output-directory overrides unset. Native Express routing preserves the incoming URL; do not add a rewrite from `/api/*` to `/api/index`.
3. **Environment variables** (Production):

| Variable | Required | Notes |
|----------|----------|--------|
| `NODE_ENV` | Yes | `production` |
| `SESSION_SECRET` | Yes | Unique long random string; never use the example/development value |
| `BASE_URL` | Yes | `https://your-app.vercel.app` (no trailing slash) |
| `SUPABASE_URL` | Yes | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **service_role** key (server only) |
| `ADMIN_PIN` | Yes | Exactly 4 digits; production rejects the local default `0000` |
| `DEFAULT_COMMISSION_RATE` | No | Default `10` |
| `STRIPE_SECRET_KEY` | For payments | Test or live key |
| `STRIPE_WEBHOOK_SECRET` | For payments | Webhook signing secret |

4. Set the same required variables separately for Preview if using preview deployments. Missing admin configuration returns a controlled 503 instead of accepting defaults.
5. Deploy. Check `https://your-app.vercel.app/api/health` — expect `"database": "supabase"` and a product count. A 404 mentioning `/api/index` means a legacy rewrite is still active.

### Admin and Business OS verification

For an existing OS database, run `supabase/os_private.sql` once as the database owner. It is repeatable and changes only OS table/sequence permissions, enables RLS, denies `anon`/`authenticated` direct access, and preserves the server's `service_role` access. New OS installs use the same protections in `supabase/os_v1.sql`. Do not rerun the storefront schema or seed scripts to repair routing.

Run `npm test` before deployment. After deployment, check `/admin/` with the configured PIN, confirm Business OS opens at `/admin/os`, then log out and confirm the page redirects to login and `/api/os/dashboard` plus OS POST endpoints return 401. `/os`, `/os/`, and `/os/index.html` must return 404. Check storefront products, content, images, cart, and checkout initialization without placing an order. Verify direct Supabase client-role access to all ten OS tables is denied.

Use Vercel Firewall rate limiting for `/api/admin/login` before exposing a four-digit PIN on the internet; an in-memory limiter is not shared across serverless instances. Keep secrets in environment settings and never paste them into logs, tests, or a PR.

### 4. Stripe webhook (when using Stripe)

Stripe Dashboard → Webhooks → Add endpoint:

- URL: `https://your-app.vercel.app/api/webhooks/stripe`
- Event: `checkout.session.completed`
- Copy signing secret → `STRIPE_WEBHOOK_SECRET` on Vercel → Redeploy

## Private analytics

Open **Analytics & growth** in admin at `/admin/os/analytics`. Paid website orders automatically populate date-based revenue, order counts, average order value, gross margin, product comparisons, referral activity, and repeat-customer metrics. The page refreshes every minute while visible. It uses order dates in America/New_York and compares adjacent 30-, 90-, or 365-day periods; today is still in progress.

Before deploying analytics to an existing database, apply `supabase/migrations/20261013171539_automatic_business_analytics.sql`. It adds two private cost tables and a checkout-time cost snapshot trigger, with RLS enabled and client access revoked. It does not alter prices, stock, orders, payment processing, or public storefront pages. Tests run the SQL in an isolated Postgres engine and verify snapshots and permissions.

In **Set up accurate margins**, enter the product purchase cost per unit once. New order items capture that default automatically. Changing a default never rewrites historical costs. Earlier sales remain unknown until their actual item costs are entered separately; missing costs withhold complete margin figures. No sales or costs are fabricated.

Scope: the daily website charts use paid website order records only. Imported spreadsheet history is presented separately in its original source periods; it is not a live Google Sheets sync. Business OS expenses and funding/consignment records are shown separately. Expected payouts are not received cash. Gross profit excludes fees and overhead; the result from recorded costs subtracts OS expenses and recorded referral commissions, but is not a complete profit-and-loss statement or bank balance. Payment/shipping fees must be entered as expenses to appear. Refunds/disputes and payment reconciliation require separate integration; a cancelled order still marked paid is explicitly flagged. Traffic conversion and advertising ROI are not reported without the necessary tracking/spend data.

### Imported business history

Apply `supabase/migrations/20261013191734_import_business_history.sql` before deploying history support. The authenticated `/api/os/history` endpoint reads dated reference records and a compact spreadsheet snapshot. Capital/debt, consignment, deal terms, purchase-cost notes, expenses and referral context appear in their matching OS sections. The analytics page displays the spreadsheet's own period labels, recorded sales and recorded profit, plus original item rows and source notes.

Imports use stable source keys so repeating an import updates a snapshot without creating duplicate entries. Business data is loaded privately into Supabase, never committed as code or a public seed file. The original source cells/formulas remain in `os_sheet_imports.source_payload` for reconciliation; that column is not returned by the dashboard API. Both history tables deny all direct browser-role access.

Historical reports do not create current cash/debt balances, storefront inventory, paid website orders, or expense postings. Unknown dates remain unknown; combined source periods remain combined. Recorded spreadsheet profit is preserved even when a missing formula is flagged for review. Ranges, approximate debt, ownership restrictions, and proposals keep their original qualification. Imported history is a dated snapshot and requires an explicit refresh import when source records change.

Duplicate paid orders with the same nonempty Stripe reference are counted once and flagged for review. Reports paginate database reads and return an explicit error instead of silently truncating totals. Cost changes and analytics endpoints require the same signed admin session; responses are private and not cached.

### Local dev vs Vercel

- Static files live in `public/` (Vercel serves them from the CDN; locally Express serves the same folder).
- Admin image uploads to `public/uploads/` work locally; on Vercel the filesystem is ephemeral — prefer seeding images under `public/products/`.
- Set `NODE_ENV=production` on Vercel for secure session cookies.

## Security notes

- Change admin password and `SESSION_SECRET` before production
- Use HTTPS in production (`NODE_ENV=production` for secure cookies)
- Do not commit `.env` or `data/shop.db` with real customer data
- Rotate Supabase **service_role** if it was ever exposed; never use it in the browser

## Owner workspace and number entry

The private `/admin/os` workspace groups inventory history, consignment, finances, deals, expenses, and referral rules behind the existing admin login. Search and filters narrow imported rows; tables show 20 records per page. Edit opens a review form with explicit Save and Cancel. Record updates validate fields on the server and reject stale edits. Original imported data remains available alongside working corrections. Corrections never become current cash or storefront stock automatically.

The AI helper prepares new expense, purchase-deal, and consignment-entry drafts from owner-entered text. It sends that text and the current Eastern date to AI Gateway; it does not send the business database or give the model database-write tools. Review and complete the form, then explicitly save. A purchase deal does not create storefront products or set partner ownership percentages. Unsupported operations and missing information are returned as questions. Existing records have direct Edit controls.

AI uses the pinned `ai` SDK, Node.js 22 or later (CI uses 24), and Vercel OIDC in deployed functions. `AI_GATEWAY_API_KEY` is an optional server-only alternative for local/non-Vercel execution; `AI_GATEWAY_MODEL` can override the default Gateway model (`openai/gpt-5.4-nano`, verified as eligible for free AI Gateway credit on October 13, 2026). Never expose either authentication credential in a client bundle. The connected Vercel team must have Gateway access and credits; configuration or credit failures leave ordinary manual forms usable. The helper does not buy credits or change account billing. Per-instance request throttling limits bursts but is not a distributed billing limit.
