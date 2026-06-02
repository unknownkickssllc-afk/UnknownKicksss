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
2. Framework: **Other** (Express is auto-detected via `server.js`)
3. **Environment variables** (Production):

| Variable | Required | Notes |
|----------|----------|--------|
| `NODE_ENV` | Yes | `production` |
| `SESSION_SECRET` | Yes | Long random string |
| `BASE_URL` | Yes | `https://your-app.vercel.app` (no trailing slash) |
| `SUPABASE_URL` | Yes | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **service_role** key (server only) |
| `ADMIN_PIN` | Yes | 4-digit admin access code (change from default `0000`) |
| `DEFAULT_COMMISSION_RATE` | No | Default `10` |
| `STRIPE_SECRET_KEY` | For payments | Test or live key |
| `STRIPE_WEBHOOK_SECRET` | For payments | Webhook signing secret |

4. Deploy. Check `https://your-app.vercel.app/api/health` — expect `"database": "supabase"` and a product count.

### 4. Stripe webhook (when using Stripe)

Stripe Dashboard → Webhooks → Add endpoint:

- URL: `https://your-app.vercel.app/api/webhooks/stripe`
- Event: `checkout.session.completed`
- Copy signing secret → `STRIPE_WEBHOOK_SECRET` on Vercel → Redeploy

### Local dev vs Vercel

- Static files live in `public/` (Vercel serves them from the CDN; locally Express serves the same folder).
- Admin image uploads to `public/uploads/` work locally; on Vercel the filesystem is ephemeral — prefer seeding images under `public/products/`.
- Set `NODE_ENV=production` on Vercel for secure session cookies.

## Security notes

- Change admin password and `SESSION_SECRET` before production
- Use HTTPS in production (`NODE_ENV=production` for secure cookies)
- Do not commit `.env` or `data/shop.db` with real customer data
- Rotate Supabase **service_role** if it was ever exposed; never use it in the browser
