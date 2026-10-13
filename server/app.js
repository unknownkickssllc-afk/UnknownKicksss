require("dotenv").config();
const express = require("express");
const cookieSession = require("cookie-session");
const path = require("path");
const Stripe = require("stripe");
const { randomBytes } = require("crypto");
const { isDeployed } = require("./lib/adminAuth");
const { fulfillOrder } = require("./services/orderProcessor");
const data = require("./data");
const { isSupabaseConfigured } = require("./lib/supabase");

// VERCEL=1 can be set locally by tooling; VERCEL_ENV is only set on Vercel deploys
const onVercel = Boolean(process.env.VERCEL_ENV);
if (!isSupabaseConfigured()) {
  if (onVercel) {
    console.warn(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on Vercel. SQLite is not supported in production."
    );
  } else {
    require("./db");
  }
}

const storeRoutes = require("./routes/store");
const checkoutRoutes = require("./routes/checkout");
const adminRoutes = require("./routes/admin");
const osRoutes = require("./routes/os");
const { requireAdminPage } = require("./middleware/auth");

const app = express();
const publicRoot = path.join(__dirname, "..", "public");

app.set("trust proxy", 1);

app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const key = process.env.STRIPE_SECRET_KEY;
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!key || !whSecret) return res.status(503).send("Stripe not configured");

    const stripe = new Stripe(key);
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        whSecret
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        try {
          await fulfillOrder(parseInt(orderId, 10));
        } catch (e) {
          console.error("Fulfillment error:", e);
          return res.status(500).json({ error: "Fulfillment failed" });
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        try {
          await fulfillOrder(parseInt(orderId, 10));
        } catch (e) {
          console.error("Fulfillment error:", e);
          return res.status(500).json({ error: "Fulfillment failed" });
        }
      }
    }
    res.json({ received: true });
  }
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cookieSession({
    name: "uk_session",
    keys: [process.env.SESSION_SECRET || (isDeployed()
      ? randomBytes(32).toString("hex")
      : "unknown-kicks-dev-secret-change-me")],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
  })
);

const logoPath = path.join(publicRoot, "logo.jpg");

// Authenticated pages and data must never be reused by a shared/browser cache.
app.use(["/api/admin", "/api/os", "/admin/os"], (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.set("Vercel-CDN-Cache-Control", "no-store");
  next();
});

app.get("/favicon.ico", (_req, res) => {
  res.type("image/jpeg");
  res.sendFile(logoPath);
});

// Admin + uploads always via Express (works locally and on Vercel)
app.use("/uploads", express.static(path.join(publicRoot, "uploads")));
const adminRoot = path.join(publicRoot, "admin");
app.get(["/admin", "/admin/"], (_req, res) => {
  res.sendFile(path.join(adminRoot, "index.html"));
});
app.get(["/admin/os", "/admin/os/"], requireAdminPage, (_req, res) => {
  res.sendFile(path.join(__dirname, "views", "os.html"));
});
app.use("/admin", express.static(adminRoot, { redirect: false }));

// Storefront — locally via Express; on Vercel, public/ is served from the CDN
if (!onVercel) {
  app.use(express.static(publicRoot));
} else {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicRoot, "index.html"));
  });
}

app.use("/api", storeRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/os", osRoutes);

app.get("/api/health", async (req, res) => {
  try {
    const count = await data.countProducts();
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    res.json({
      ok: true,
      products: count,
      database: isSupabaseConfigured() ? "supabase" : "sqlite",
      platform: onVercel ? "vercel" : "node",
      stripe: Boolean(stripeKey && !stripeKey.includes("...")),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = app;
