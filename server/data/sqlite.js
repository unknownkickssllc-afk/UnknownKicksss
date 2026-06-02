const { db } = require("../db");
const { validateCartItems } = require("../services/cartValidation");

function mapProductSync(row) {
  const images = db
    .prepare("SELECT url, sort_order, is_hover FROM product_images WHERE product_id = ? ORDER BY sort_order")
    .all(row.id);
  const variants = db
    .prepare("SELECT id, size, color, stock, sku FROM product_variants WHERE product_id = ? ORDER BY color, size")
    .all(row.id);
  const category = row.category_id
    ? db.prepare("SELECT id, name, slug FROM categories WHERE id = ?").get(row.category_id)
    : null;
  const totalStock = variants.reduce((s, v) => s + v.stock, 0);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    price: row.price,
    soldOut: !!row.sold_out || totalStock === 0,
    sold_out: row.sold_out,
    category,
    category_id: row.category_id,
    images: images.map((i) => ({ url: i.url, isHover: !!i.is_hover })),
    imagePrimary: images[0]?.url || null,
    imageHover: images.find((i) => i.is_hover)?.url || images[1]?.url || images[0]?.url,
    gallery: images.map((i) => i.url),
    variants,
    colors: [...new Set(variants.map((v) => v.color))],
    sizes: [...new Set(variants.map((v) => v.size))],
    stock: totalStock,
    sizeChart: JSON.parse(row.size_chart_json || "[]"),
    shippingInfo: row.shipping_info || "",
    shipping_info: row.shipping_info,
    size_chart_json: row.size_chart_json,
  };
}

function getVariantSync(id) {
  return db
    .prepare(
      `SELECT v.*, p.name as product_name, p.price, p.sold_out, p.slug
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`
    )
    .get(id);
}

async function getSiteContent() {
  const rows = db.prepare("SELECT key, value FROM site_content").all();
  const content = {};
  for (const r of rows) {
    try {
      content[r.key] = JSON.parse(r.value);
    } catch {
      content[r.key] = r.value;
    }
  }
  return content;
}

async function getCategories() {
  return db.prepare("SELECT id, name, slug FROM categories ORDER BY sort_order").all();
}

async function getProducts(categorySlug) {
  let rows;
  if (categorySlug) {
    const cat = db.prepare("SELECT id FROM categories WHERE slug = ?").get(categorySlug);
    if (!cat) return [];
    rows = db.prepare("SELECT * FROM products WHERE category_id = ? ORDER BY created_at DESC").all(cat.id);
  } else {
    rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
  }
  return rows.map(mapProductSync);
}

async function getProductBySlug(slug) {
  const row = db.prepare("SELECT * FROM products WHERE slug = ?").get(slug);
  return row ? mapProductSync(row) : null;
}

async function getVariant(id) {
  return getVariantSync(id);
}

async function validateReferralCode(code) {
  if (!code || !String(code).trim()) return null;
  const normalized = String(code).trim().toUpperCase();
  const row = db
    .prepare(
      `SELECT rc.*, b.name as barber_name, b.active, b.commission_rate
       FROM referral_codes rc JOIN barbers b ON b.id = rc.barber_id WHERE rc.code = ?`
    )
    .get(normalized);
  if (!row) return { valid: false, error: "Invalid referral code" };
  if (row.used_at) return { valid: false, error: "This referral code has already been used" };
  if (!row.active) return { valid: false, error: "Barber profile is inactive" };
  return {
    valid: true,
    id: row.id,
    barberId: row.barber_id,
    barberName: row.barber_name,
    commissionRate: row.commission_rate,
    code: row.code,
  };
}

async function saveCustomer({ email, name, phone }) {
  const existing = db.prepare("SELECT id FROM customers WHERE email = ?").get(email);
  if (existing) {
    db.prepare("UPDATE customers SET name = ?, phone = ? WHERE id = ?").run(name, phone || null, existing.id);
    return existing.id;
  }
  return db.prepare("INSERT INTO customers (email, name, phone) VALUES (?, ?, ?)").run(email, name, phone || null)
    .lastInsertRowid;
}

async function createPendingOrder({ customer, shipping, billing, items, referralCode, stripeSessionId }) {
  const { items: validated, subtotal, total } = await validateCartItems(items, getVariant);
  let referral = null;
  if (referralCode) {
    referral = await validateReferralCode(referralCode);
    if (!referral.valid) throw new Error(referral.error);
  }
  const orderNumber = `UK-${Date.now().toString(36).toUpperCase()}`;
  const customerId = await saveCustomer(customer);

  const insert = db.transaction(() => {
    const orderResult = db
      .prepare(
        `INSERT INTO orders (order_number, status, payment_status, stripe_session_id,
         customer_id, customer_name, customer_email, customer_phone, shipping_json, billing_json,
         referral_code_id, barber_id, referral_code_text, subtotal, total)
         VALUES (?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderNumber,
        stripeSessionId || null,
        customerId,
        customer.name,
        customer.email,
        customer.phone || null,
        JSON.stringify(shipping),
        billing ? JSON.stringify(billing) : null,
        referral?.id || null,
        referral?.barberId || null,
        referral?.code || null,
        subtotal,
        total
      );
    const orderId = orderResult.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, color, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of validated) {
      insertItem.run(
        orderId,
        item.productId,
        item.variantId,
        item.productName,
        item.size,
        item.color,
        item.quantity,
        item.unitPrice,
        item.lineTotal
      );
    }
    return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  });
  return insert();
}

async function fulfillOrder(orderId) {
  const fulfill = db.transaction(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    if (!order) throw new Error("Order not found");
    if (order.payment_status === "paid") return order;
    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);
    for (const item of items) {
      const result = db
        .prepare("UPDATE product_variants SET stock = stock - ? WHERE id = ? AND stock >= ?")
        .run(item.quantity, item.variant_id, item.quantity);
      if (result.changes === 0) throw new Error(`Stock update failed for variant ${item.variant_id}`);
    }
    db.prepare("UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE id = ?").run(orderId);
    if (order.referral_code_id) {
      db.prepare(
        "UPDATE referral_codes SET used_at = datetime('now'), order_id = ? WHERE id = ? AND used_at IS NULL"
      ).run(orderId, order.referral_code_id);
      const barber = db.prepare("SELECT * FROM barbers WHERE id = ?").get(order.barber_id);
      if (barber) {
        const rate = barber.commission_rate ?? 10;
        const amount = Math.round(order.total * (rate / 100) * 100) / 100;
        if (!db.prepare("SELECT id FROM commissions WHERE order_id = ?").get(orderId)) {
          db.prepare(
            `INSERT INTO commissions (barber_id, order_id, amount, rate_percent, status) VALUES (?, ?, ?, ?, 'unpaid')`
          ).run(barber.id, orderId, amount, rate);
        }
      }
    }
    return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  });
  return fulfill();
}

async function getOrderByNumber(orderNumber) {
  const order = db
    .prepare(
      `SELECT o.*, b.name as barber_name FROM orders o LEFT JOIN barbers b ON b.id = o.barber_id WHERE o.order_number = ?`
    )
    .get(orderNumber);
  if (!order) return null;

  const getPrimaryImage = db.prepare(
    "SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1"
  );
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);

  return {
    ...order,
    shipping: JSON.parse(order.shipping_json),
    billing: order.billing_json ? JSON.parse(order.billing_json) : null,
    items: enrichItemsWithProductImages(items),
  };
}

async function countProducts() {
  return db.prepare("SELECT COUNT(*) as c FROM products").get().c;
}

async function getAdminByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return db.prepare("SELECT * FROM admin_users WHERE LOWER(email) = ?").get(normalized);
}

async function upsertAdmin(email, passwordHash) {
  const normalized = String(email || "").trim().toLowerCase();
  const existing = await getAdminByEmail(normalized);
  if (existing) {
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE email = ?").run(passwordHash, existing.email);
    return existing.id;
  }
  return db.prepare("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)").run(normalized, passwordHash)
    .lastInsertRowid;
}

async function clearCatalog() {
  db.pragma("foreign_keys = OFF");
  db.exec("DELETE FROM commissions");
  db.exec("DELETE FROM order_items");
  db.exec("DELETE FROM referral_codes");
  db.exec("DELETE FROM orders");
  db.exec("DELETE FROM customers");
  db.exec("DELETE FROM product_variants");
  db.exec("DELETE FROM product_images");
  db.exec("DELETE FROM products");
  db.exec("DELETE FROM categories");
  db.exec("DELETE FROM barbers");
  db.exec("DELETE FROM site_content");
  db.pragma("foreign_keys = ON");
}

/** Removes orders, barbers, customers, and referral data. Keeps products, categories, and site content. */
async function clearDemoData() {
  db.pragma("foreign_keys = OFF");
  db.exec("DELETE FROM commissions");
  db.exec("DELETE FROM order_items");
  db.exec("DELETE FROM referral_codes");
  db.exec("DELETE FROM orders");
  db.exec("DELETE FROM customers");
  db.exec("DELETE FROM barbers");
  db.exec("DELETE FROM admin_users");
  db.pragma("foreign_keys = ON");
}

async function insertCategory(c) {
  const r = db.prepare("INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)").run(c.name, c.slug, c.sort_order);
  return { id: r.lastInsertRowid, ...c };
}

async function insertProduct(p) {
  const r = db
    .prepare(
      `INSERT INTO products (name, slug, description, price, category_id, sold_out, size_chart_json, shipping_info) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      p.name,
      p.slug,
      p.description,
      p.price,
      p.category_id,
      JSON.stringify(p.size_chart_json || []),
      p.shipping_info || ""
    );
  return { id: r.lastInsertRowid, ...p };
}

async function insertProductImage(img) {
  db.prepare(
    `INSERT INTO product_images (product_id, url, sort_order, is_hover) VALUES (?, ?, ?, ?)`
  ).run(img.product_id, img.url, img.sort_order, img.is_hover ? 1 : 0);
}

async function insertVariant(v) {
  db.prepare(`INSERT INTO product_variants (product_id, size, color, stock, sku) VALUES (?, ?, ?, ?, ?)`).run(
    v.product_id,
    v.size,
    v.color,
    v.stock,
    v.sku
  );
}

async function insertSiteContent(key, value) {
  db.prepare("INSERT OR REPLACE INTO site_content (key, value) VALUES (?, ?)").run(
    key,
    JSON.stringify(value)
  );
}

async function insertBarber(b) {
  const r = db
    .prepare(`INSERT INTO barbers (name, email, phone, commission_rate, active) VALUES (?, ?, ?, ?, ?)`)
    .run(b.name, b.email, b.phone, b.commission_rate, b.active ? 1 : 0);
  return { id: r.lastInsertRowid };
}

async function insertReferralCode(barberId, code) {
  db.prepare("INSERT INTO referral_codes (barber_id, code) VALUES (?, ?)").run(barberId, code);
}

async function getAllProductsAdmin() {
  const products = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
  return products.map((p) => ({
    ...p,
    variants: db.prepare("SELECT * FROM product_variants WHERE product_id = ?").all(p.id),
    images: db.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order").all(p.id),
  }));
}

function enrichItemsWithProductImages(items) {
  if (!items?.length) return [];
  const getPrimaryImage = db.prepare(
    "SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1"
  );
  return items.map((item) => ({
    ...item,
    image: getPrimaryImage.get(item.product_id)?.url || null,
  }));
}

async function getAllOrdersAdmin() {
  const orders = db
    .prepare(`SELECT o.*, b.name as barber_name FROM orders o LEFT JOIN barbers b ON b.id = o.barber_id ORDER BY o.created_at DESC`)
    .all();
  return orders.map((o) => ({
    ...o,
    shipping: JSON.parse(o.shipping_json),
    billing: o.billing_json ? JSON.parse(o.billing_json) : null,
    items: enrichItemsWithProductImages(
      db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(o.id)
    ),
  }));
}

async function getOrderAdmin(id) {
  const o = db
    .prepare(`SELECT o.*, b.name as barber_name FROM orders o LEFT JOIN barbers b ON b.id = o.barber_id WHERE o.id = ?`)
    .get(id);
  if (!o) return null;
  return {
    ...o,
    shipping: JSON.parse(o.shipping_json),
    billing: o.billing_json ? JSON.parse(o.billing_json) : null,
    items: enrichItemsWithProductImages(db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(id)),
  };
}

async function updateOrderStatus(id, status) {
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
}

async function createProduct(body) {
  const r = db
    .prepare(
      `INSERT INTO products (name, slug, description, price, category_id, sold_out, shipping_info, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      body.name,
      body.slug,
      body.description || "",
      body.price,
      body.category_id || null,
      body.sold_out ? 1 : 0,
      body.shipping_info || ""
    );
  return { id: r.lastInsertRowid };
}

async function updateProduct(id, body) {
  db.prepare(
    `UPDATE products SET name=?, slug=?, description=?, price=?, category_id=?, sold_out=?,
     shipping_info=?, size_chart_json=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    body.name,
    body.slug,
    body.description,
    body.price,
    body.category_id,
    body.sold_out ? 1 : 0,
    body.shipping_info,
    body.size_chart_json ? JSON.stringify(body.size_chart_json) : "[]",
    id
  );
}

async function deleteProduct(id) {
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
}

async function addProductImage(productId, url, sortOrder, isHover) {
  const r = db
    .prepare(`INSERT INTO product_images (product_id, url, sort_order, is_hover) VALUES (?, ?, ?, ?)`)
    .run(productId, url, sortOrder, isHover ? 1 : 0);
  return { id: r.lastInsertRowid, url };
}

async function deleteProductImage(id) {
  return db.prepare("SELECT url FROM product_images WHERE id = ?").get(id);
}

async function addVariant(productId, v) {
  const r = db
    .prepare(`INSERT INTO product_variants (product_id, size, color, stock, sku) VALUES (?, ?, ?, ?, ?)`)
    .run(productId, v.size, v.color, v.stock, v.sku || null);
  return { id: r.lastInsertRowid };
}

async function updateVariant(id, v) {
  db.prepare("UPDATE product_variants SET size=?, color=?, stock=?, sku=? WHERE id=?").run(
    v.size,
    v.color,
    v.stock,
    v.sku,
    id
  );
}

async function deleteVariant(id) {
  db.prepare("DELETE FROM product_variants WHERE id = ?").run(id);
}

async function getCategoriesAdmin() {
  return getCategories();
}

async function insertCategoryAdmin(c) {
  return insertCategory(c);
}

async function updateSiteContent(updates) {
  const stmt = db.prepare("INSERT OR REPLACE INTO site_content (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(updates)) {
    stmt.run(key, JSON.stringify(value));
  }
}

function fetchBarberPerformance(barberId) {
  const id = Number(barberId) || barberId;
  const barber = db.prepare("SELECT * FROM barbers WHERE id = ?").get(id);
  if (!barber) throw new Error("Barber not found");

  const codes = db
    .prepare(
      "SELECT id, code, used_at, order_id, created_at FROM referral_codes WHERE barber_id = ? ORDER BY created_at DESC"
    )
    .all(id);

  const directOrders = db
    .prepare(
      `SELECT * FROM orders WHERE barber_id = ? AND payment_status = 'paid' ORDER BY created_at DESC`
    )
    .all(id);

  const linkedIds = [
    ...new Set(codes.map((c) => c.order_id).filter((oid) => oid != null)),
  ];
  let linkedOrders = [];
  if (linkedIds.length) {
    const placeholders = linkedIds.map(() => "?").join(",");
    linkedOrders = db
      .prepare(
        `SELECT * FROM orders WHERE id IN (${placeholders}) AND payment_status = 'paid'`
      )
      .all(...linkedIds);
  }

  const ordersById = new Map();
  for (const o of [...directOrders, ...linkedOrders]) ordersById.set(o.id, o);
  const orders = [...ordersById.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const commissions = db
    .prepare("SELECT * FROM commissions WHERE barber_id = ? ORDER BY created_at DESC")
    .all(id);

  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))];
  let customers = [];
  if (customerIds.length) {
    const placeholders = customerIds.map(() => "?").join(",");
    customers = db
      .prepare(`SELECT * FROM customers WHERE id IN (${placeholders})`)
      .all(...customerIds);
  }

  const stats = {
    total_orders: orders.length,
    total_sales: orders.reduce((s, o) => s + Number(o.total), 0),
    unpaid_commissions: commissions
      .filter((c) => c.status === "unpaid")
      .reduce((s, c) => s + Number(c.amount), 0),
    paid_commissions: commissions
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + Number(c.amount), 0),
  };

  return { barber, referralCodes: codes, orders, commissions, customers, stats };
}

async function getAllBarbersAdmin() {
  const barbers = db.prepare("SELECT * FROM barbers ORDER BY name").all();
  return barbers.map((b) => {
    const perf = fetchBarberPerformance(b.id);
    return { ...b, referralCodes: perf.referralCodes, stats: perf.stats };
  });
}

async function createBarber(body) {
  const r = db
    .prepare(`INSERT INTO barbers (name, email, phone, commission_rate, active) VALUES (?, ?, ?, ?, ?)`)
    .run(body.name, body.email, body.phone, body.commission_rate, body.active ? 1 : 0);
  return { id: r.lastInsertRowid };
}

async function updateBarber(id, body) {
  db.prepare(`UPDATE barbers SET name=?, email=?, phone=?, commission_rate=?, active=? WHERE id=?`).run(
    body.name,
    body.email || null,
    body.phone || null,
    body.commission_rate,
    body.active ? 1 : 0,
    id
  );
}

async function deleteBarber(id) {
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM commissions WHERE barber_id = ?").run(id);
  db.prepare(
    "UPDATE orders SET referral_code_id = NULL, barber_id = NULL WHERE barber_id = ?"
  ).run(id);
  db.prepare("DELETE FROM referral_codes WHERE barber_id = ?").run(id);
  const r = db.prepare("DELETE FROM barbers WHERE id = ?").run(id);
  db.pragma("foreign_keys = ON");
  if (!r.changes) throw new Error("Barber not found");
}

async function generateReferralCodes(barberId, count) {
  const { v4: uuidv4 } = require("uuid");
  const created = [];
  for (let i = 0; i < count; i++) {
    const code = `UK-${uuidv4().split("-")[0].toUpperCase()}`;
    try {
      db.prepare("INSERT INTO referral_codes (barber_id, code) VALUES (?, ?)").run(barberId, code);
      created.push(code);
    } catch {
      i--;
    }
  }
  return created;
}

async function getBarberDashboard(barberId) {
  const perf = fetchBarberPerformance(barberId);
  return {
    barber: perf.barber,
    orders: perf.orders,
    commissions: perf.commissions,
    customers: perf.customers,
    stats: {
      totalOrders: perf.stats.total_orders,
      totalSales: perf.stats.total_sales,
      unpaidCommissions: perf.stats.unpaid_commissions,
      paidCommissions: perf.stats.paid_commissions,
    },
  };
}

async function payCommission(id) {
  db.prepare("UPDATE commissions SET status = 'paid', paid_at = datetime('now') WHERE id = ?").run(id);
}

async function payAllCommissions(barberId) {
  db.prepare(
    `UPDATE commissions SET status = 'paid', paid_at = datetime('now') WHERE barber_id = ? AND status = 'unpaid'`
  ).run(barberId);
}

async function updateOrderStripeSession(orderId, sessionId) {
  db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(sessionId, orderId);
}

module.exports = {
  getSiteContent,
  getCategories,
  getProducts,
  getProductBySlug,
  getVariant,
  validateReferralCode,
  saveCustomer,
  createPendingOrder,
  fulfillOrder,
  getOrderByNumber,
  countProducts,
  getAdminByEmail,
  upsertAdmin,
  clearCatalog,
  clearDemoData,
  insertCategory,
  insertProduct,
  insertProductImage,
  insertVariant,
  insertSiteContent,
  insertBarber,
  insertReferralCode,
  getAllProductsAdmin,
  getAllOrdersAdmin,
  getOrderAdmin,
  updateOrderStatus,
  createProduct,
  updateProduct,
  deleteProduct,
  addProductImage,
  deleteProductImage,
  addVariant,
  updateVariant,
  deleteVariant,
  getCategoriesAdmin,
  insertCategoryAdmin,
  updateSiteContent,
  getAllBarbersAdmin,
  createBarber,
  updateBarber,
  deleteBarber,
  generateReferralCodes,
  getBarberDashboard,
  payCommission,
  payAllCommissions,
  updateOrderStripeSession,
};
