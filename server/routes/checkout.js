const express = require("express");
const Stripe = require("stripe");
const data = require("../data");
const { createPendingOrder, fulfillOrder } = require("../services/orderProcessor");

const router = express.Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("...")) return null;
  return new Stripe(key);
}

router.post("/create-session", async (req, res) => {
  try {
    const { items, customer, shipping, referralCode } = req.body;
    if (!customer?.email || !customer?.name) {
      return res.status(400).json({ error: "Customer name and email required" });
    }
    if (!shipping?.line1 || !shipping?.city || !shipping?.zip) {
      return res.status(400).json({ error: "Complete shipping address required" });
    }

    const order = await createPendingOrder({
      items,
      customer,
      shipping,
      referralCode,
      stripeSessionId: null,
    });

    const stripe = getStripe();
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    if (!stripe) {
      return res.json({
        devMode: true,
        orderId: order.id,
        orderNumber: order.order_number,
        message: "Stripe not configured. Use /api/checkout/complete-dev to finish.",
      });
    }

    const products = await data.getAllProductsAdmin();
    const imageByProduct = {};
    for (const p of products) {
      imageByProduct[p.id] = p.images[0]?.url;
    }

    const orderFull = await data.getOrderAdmin(order.id);
    const lineItems = orderFull.items.map((oi) => {
      const img = imageByProduct[oi.product_id];
      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${oi.product_name} — ${oi.size} / ${oi.color}`,
            images: img ? [`${baseUrl}${img.startsWith("/") ? "" : "/"}${img}`] : undefined,
          },
          unit_amount: Math.round(Number(oi.unit_price) * 100),
        },
        quantity: oi.quantity,
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email,
      line_items: lineItems,
      success_url: `${baseUrl}/confirmation.html?order=${order.order_number}`,
      cancel_url: `${baseUrl}/checkout.html?cancelled=1`,
      metadata: { orderId: String(order.id) },
    });

    await data.updateOrderStripeSession(order.id, session.id);
    res.json({ url: session.url, orderNumber: order.order_number });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/complete-dev", async (req, res) => {
  const stripe = getStripe();
  if (stripe && process.env.ALLOW_DEV_CHECKOUT !== "true") {
    return res.status(403).json({
      error: "Stripe is configured. Use payment checkout or set ALLOW_DEV_CHECKOUT=true for testing.",
    });
  }

  try {
    const { items, customer, shipping, referralCode } = req.body;
    const order = await createPendingOrder({ items, customer, shipping, referralCode });
    await fulfillOrder(order.id);
    const full = await data.getOrderByNumber(order.order_number);
    res.json({ success: true, order: full });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/order/:orderNumber", async (req, res) => {
  try {
    const order = await data.getOrderByNumber(req.params.orderNumber);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
