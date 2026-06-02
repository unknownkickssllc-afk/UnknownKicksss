require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const Stripe = require("stripe");
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

const app = express();
const publicRoot = path.join(__dirname, "..", "public");

app.set("trust proxy", 1);

app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  (req, res) => {
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
          fulfillOrder(parseInt(orderId, 10));
        } catch (e) {
          console.error("Fulfillment error:", e);
        }
      }
    }
    res.json({ received: true });
  }
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "unknown-kicks-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const logoPath = path.join(publicRoot, "logo.jpg");

app.get("/favicon.ico", (_req, res) => {
  res.type("image/jpeg");
  res.sendFile(logoPath);
});

// Admin + uploads always via Express (works locally and on Vercel)
app.use("/uploads", express.static(path.join(publicRoot, "uploads")));
app.use(
  "/admin",
  express.static(path.join(publicRoot, "admin"), { index: "index.html" })
);

// Storefront — locally via Express; on Vercel, public/ is served from the CDN
if (!onVercel) {
  app.use(express.static(publicRoot));
}

app.use("/api", storeRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", async (req, res) => {
  try {
    const count = await data.countProducts();
    res.json({
      ok: true,
      products: count,
      database: isSupabaseConfigured() ? "supabase" : "sqlite",
      platform: onVercel ? "vercel" : "node",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = app;
