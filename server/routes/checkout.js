const express = require("express");
const Stripe = require("stripe");
const data = require("../data");
const { resolveBillingForStorage } = require("../lib/addresses");
const { createPendingOrder, fulfillOrder } = require("../services/orderProcessor");

const router = express.Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("...")) return null;
  return new Stripe(key);
}

function getPublishableKey() {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key || key.includes("...")) return null;
  return key;
}

function validateCheckoutPayload({ customer, shipping }) {
  if (!customer?.email || !customer?.name) {
    return "Customer name and email required";
  }
  if (!shipping?.line1 || !shipping?.city || !shipping?.zip) {
    return "Complete shipping address required";
  }
  return null;
}

function buildOrderInput(body) {
  const { items, customer, shipping, billing, billingSame, referralCode, paymentIntentId } = body;
  return {
    items,
    customer,
    shipping,
    billing: resolveBillingForStorage({ shipping, billing, billingSame }),
    referralCode,
    paymentIntentId,
  };
}

router.get("/config", (_req, res) => {
  const publishableKey = getPublishableKey();
  const stripe = getStripe();
  res.json({
    publishableKey,
    devMode: !stripe || !publishableKey,
  });
});

/** Create PaymentIntent on page load so the Payment Element can mount immediately. */
router.post("/prepare-payment", async (req, res) => {
  try {
    const { items } = req.body;
    const { validateCartItems } = require("../services/cartValidation");
    const { total } = await validateCartItems(items || [], data.getVariant);

    const publishableKey = getPublishableKey();
    const stripe = getStripe();
    if (!stripe || !publishableKey) {
      return res.json({ devMode: true });
    }

    const amountCents = Math.round(Number(total) * 100);
    if (amountCents < 50) {
      return res.status(400).json({ error: "Minimum order amount is $0.50" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
    });

    res.json({
      publishableKey,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: Number(total),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Create order and attach it to the PaymentIntent before confirming payment. */
router.post("/finalize-order", async (req, res) => {
  try {
    const { items, customer, shipping, billing, billingSame, referralCode, paymentIntentId } = buildOrderInput(req.body);
    const validationError = validateCheckoutPayload({ customer, shipping });
    if (validationError) return res.status(400).json({ error: validationError });
    if (!paymentIntentId) {
      return res.status(400).json({ error: "Payment session expired. Refresh the page and try again." });
    }

    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "Stripe not configured" });

    const order = await createPendingOrder({
      items,
      customer,
      shipping,
      billing,
      referralCode,
      stripeSessionId: paymentIntentId,
    });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const expectedAmount = Math.round(Number(order.total) * 100);
    if (intent.amount !== expectedAmount) {
      return res.status(400).json({ error: "Order total changed. Refresh the page and try again." });
    }

    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: { orderId: String(order.id), orderNumber: order.order_number },
      receipt_email: customer.email,
      shipping: {
        name: customer.name,
        phone: customer.phone || undefined,
        address: {
          line1: shipping.line1,
          line2: shipping.line2 || undefined,
          city: shipping.city,
          state: shipping.state || undefined,
          postal_code: shipping.zip,
          country: shipping.country || "US",
        },
      },
    });

    await data.updateOrderStripeSession(order.id, paymentIntentId);

    res.json({
      orderNumber: order.order_number,
      clientSecret: intent.client_secret,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/create-payment-intent", async (req, res) => {
  try {
    const { items, customer, shipping, billing, referralCode } = buildOrderInput(req.body);
    const validationError = validateCheckoutPayload({ customer, shipping });
    if (validationError) return res.status(400).json({ error: validationError });

    const order = await createPendingOrder({
      items,
      customer,
      shipping,
      billing,
      referralCode,
      stripeSessionId: null,
    });

    const stripe = getStripe();
    if (!stripe) {
      return res.json({
        devMode: true,
        orderId: order.id,
        orderNumber: order.order_number,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(order.total) * 100),
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { orderId: String(order.id), orderNumber: order.order_number },
      receipt_email: customer.email,
      shipping: {
        name: customer.name,
        phone: customer.phone || undefined,
        address: {
          line1: shipping.line1,
          line2: shipping.line2 || undefined,
          city: shipping.city,
          state: shipping.state || undefined,
          postal_code: shipping.zip,
          country: shipping.country || "US",
        },
      },
    });

    await data.updateOrderStripeSession(order.id, paymentIntent.id);

    res.json({
      clientSecret: paymentIntent.client_secret,
      orderNumber: order.order_number,
      amount: Number(order.total),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/create-session", async (req, res) => {
  try {
    const { items, customer, shipping, billing, referralCode } = buildOrderInput(req.body);
    const validationError = validateCheckoutPayload({ customer, shipping });
    if (validationError) return res.status(400).json({ error: validationError });

    const order = await createPendingOrder({
      items,
      customer,
      shipping,
      billing,
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
    const { items, customer, shipping, billing, referralCode } = buildOrderInput(req.body);
    const order = await createPendingOrder({ items, customer, shipping, billing, referralCode });
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

async function verifyStripePayment(order) {
  const stripe = getStripe();
  if (!stripe || !order.stripe_session_id) return order;

  const ref = order.stripe_session_id;
  if (ref.startsWith("pi_")) {
    const intent = await stripe.paymentIntents.retrieve(ref);
    if (intent.status === "succeeded") {
      await fulfillOrder(order.id);
      return data.getOrderByNumber(order.order_number);
    }
    return order;
  }

  const session = await stripe.checkout.sessions.retrieve(ref);
  if (session.payment_status === "paid") {
    await fulfillOrder(order.id);
    return data.getOrderByNumber(order.order_number);
  }
  return order;
}

/** After Stripe redirect — fulfill if webhook hasn't run yet (common in local dev). */
router.post("/verify/:orderNumber", async (req, res) => {
  try {
    const order = await data.getOrderByNumber(req.params.orderNumber);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.payment_status === "paid") return res.json(order);
    res.json(await verifyStripePayment(order));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
