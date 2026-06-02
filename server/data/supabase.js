const { supabase } = require("../lib/supabase");

function row(r) {
  if (!r) return r;
  const o = { ...r };
  if (typeof o.sold_out === "boolean") o.sold_out = o.sold_out ? 1 : 0;
  return o;
}

function parseOrderAddresses(order) {
  const shippingRaw = order.shipping_json || {};
  const shipping = { ...shippingRaw };
  const billing = order.billing_json || shipping._billing || null;
  if (shipping._billing) delete shipping._billing;
  return { shipping, billing };
}

function shippingPayloadForInsert(shipping, billing, embedBillingOnly = false) {
  if (!billing) return shipping;
  if (embedBillingOnly) return { ...shipping, _billing: billing };
  return shipping;
}

async function mapProduct(sb, product) {
  const [{ data: images }, { data: variants }, category] = await Promise.all([
    sb.from("product_images").select("url, sort_order, is_hover").eq("product_id", product.id).order("sort_order"),
    sb.from("product_variants").select("id, size, color, stock, sku").eq("product_id", product.id).order("id"),
    product.category_id
      ? sb.from("categories").select("id, name, slug").eq("id", product.category_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const imgs = images || [];
  const vars = variants || [];
  const totalStock = vars.reduce((s, v) => s + v.stock, 0);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    soldOut: product.sold_out || totalStock === 0,
    sold_out: product.sold_out,
    category: category?.data || null,
    category_id: product.category_id,
    images: imgs.map((i) => ({ url: i.url, isHover: i.is_hover })),
    imagePrimary: imgs[0]?.url || null,
    imageHover: imgs.find((i) => i.is_hover)?.url || imgs[1]?.url || imgs[0]?.url,
    gallery: imgs.map((i) => i.url),
    variants: vars,
    colors: [...new Set(vars.map((v) => v.color))],
    sizes: [...new Set(vars.map((v) => v.size))],
    stock: totalStock,
    sizeChart: product.size_chart_json || [],
    shippingInfo: product.shipping_info || "",
    shipping_info: product.shipping_info,
    size_chart_json: product.size_chart_json,
  };
}

async function getSiteContent() {
  const { data, error } = await supabase().from("site_content").select("key, value");
  if (error) throw error;
  const content = {};
  for (const r of data || []) content[r.key] = r.value;
  return content;
}

async function getCategories() {
  const { data, error } = await supabase().from("categories").select("id, name, slug").order("sort_order");
  if (error) throw error;
  return data;
}

async function getProducts(categorySlug) {
  const sb = supabase();
  let q = sb.from("products").select("*").order("created_at", { ascending: false });
  if (categorySlug) {
    const { data: cat } = await sb.from("categories").select("id").eq("slug", categorySlug).single();
    if (!cat) return [];
    q = q.eq("category_id", cat.id);
  }
  const { data, error } = await q;
  if (error) throw error;
  return Promise.all((data || []).map((p) => mapProduct(sb, p)));
}

async function getProductBySlug(slug) {
  const sb = supabase();
  const { data, error } = await sb.from("products").select("*").eq("slug", slug).single();
  if (error || !data) return null;
  return mapProduct(sb, data);
}

async function getVariant(id) {
  const { data: v, error } = await supabase()
    .from("product_variants")
    .select("*, products(name, price, sold_out, slug)")
    .eq("id", id)
    .single();
  if (error || !v) return null;
  const p = v.products;
  return {
    id: v.id,
    product_id: v.product_id,
    size: v.size,
    color: v.color,
    stock: v.stock,
    product_name: p.name,
    price: Number(p.price),
    sold_out: p.sold_out,
    slug: p.slug,
  };
}

async function validateReferralCode(code) {
  if (!code || !String(code).trim()) return null;
  const normalized = String(code).trim().toUpperCase();
  const { data: rc, error } = await supabase()
    .from("referral_codes")
    .select("*, barbers(name, active, commission_rate)")
    .eq("code", normalized)
    .single();
  if (error || !rc) return { valid: false, error: "Invalid referral code" };
  if (rc.used_at) return { valid: false, error: "This referral code has already been used" };
  if (!rc.barbers?.active) return { valid: false, error: "Barber profile is inactive" };
  return {
    valid: true,
    id: rc.id,
    barberId: rc.barber_id,
    barberName: rc.barbers.name,
    commissionRate: Number(rc.barbers.commission_rate),
    code: rc.code,
  };
}

async function saveCustomer({ email, name, phone }) {
  const sb = supabase();
  const { data: existing } = await sb.from("customers").select("id").eq("email", email).maybeSingle();
  if (existing) {
    await sb.from("customers").update({ name, phone }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await sb.from("customers").insert({ email, name, phone }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function createPendingOrder({ customer, shipping, billing, items, referralCode, stripeSessionId }) {
  const { validateCartItems } = require("../services/cartValidation");
  const { items: validated, subtotal, total } = await validateCartItems(items, getVariant);

  let referral = null;
  if (referralCode) {
    referral = await validateReferralCode(referralCode);
    if (!referral.valid) throw new Error(referral.error);
  }

  const orderNumber = `UK-${Date.now().toString(36).toUpperCase()}`;
  const customerId = await saveCustomer(customer);
  const sb = supabase();

  const baseRow = {
    order_number: orderNumber,
    status: "pending",
    payment_status: "pending",
    stripe_session_id: stripeSessionId || null,
    customer_id: customerId,
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone || null,
    shipping_json: shipping,
    referral_code_id: referral?.id || null,
    barber_id: referral?.barberId || null,
    referral_code_text: referral?.code || null,
    subtotal,
    total,
  };

  let order;
  let orderErr;
  ({ data: order, error: orderErr } = await sb
    .from("orders")
    .insert({ ...baseRow, billing_json: billing || null })
    .select()
    .single());

  if (orderErr && /billing_json/.test(orderErr.message || "")) {
    ({ data: order, error: orderErr } = await sb
      .from("orders")
      .insert({
        ...baseRow,
        shipping_json: shippingPayloadForInsert(shipping, billing, true),
      })
      .select()
      .single());
  }
  if (orderErr) throw orderErr;

  const orderItems = validated.map((i) => ({
    order_id: order.id,
    product_id: i.productId,
    variant_id: i.variantId,
    product_name: i.productName,
    size: i.size,
    color: i.color,
    quantity: i.quantity,
    unit_price: i.unitPrice,
    line_total: i.lineTotal,
  }));

  const { error: itemsErr } = await sb.from("order_items").insert(orderItems);
  if (itemsErr) throw itemsErr;

  return order;
}

async function fulfillOrder(orderId) {
  const sb = supabase();
  const { data: order, error } = await sb.from("orders").select("*").eq("id", orderId).single();
  if (error || !order) throw new Error("Order not found");
  if (order.payment_status === "paid") return order;

  const { data: items } = await sb.from("order_items").select("*").eq("order_id", orderId);

  for (const item of items || []) {
    const { data: variant } = await sb
      .from("product_variants")
      .select("stock")
      .eq("id", item.variant_id)
      .single();
    if (!variant || variant.stock < item.quantity) {
      throw new Error(`Stock update failed for variant ${item.variant_id}`);
    }
    const { error: stockErr } = await sb
      .from("product_variants")
      .update({ stock: variant.stock - item.quantity })
      .eq("id", item.variant_id)
      .eq("stock", variant.stock);
    if (stockErr) throw stockErr;
  }

  await sb.from("orders").update({ payment_status: "paid", status: "confirmed" }).eq("id", orderId);

  if (order.referral_code_id) {
    await sb
      .from("referral_codes")
      .update({ used_at: new Date().toISOString(), order_id: orderId })
      .eq("id", order.referral_code_id)
      .is("used_at", null);

    const { data: barber } = await sb.from("barbers").select("*").eq("id", order.barber_id).single();
    if (barber) {
      const rate = Number(barber.commission_rate) || 10;
      const amount = Math.round(Number(order.total) * (rate / 100) * 100) / 100;
      const { data: existing } = await sb.from("commissions").select("id").eq("order_id", orderId).maybeSingle();
      if (!existing) {
        await sb.from("commissions").insert({
          barber_id: barber.id,
          order_id: orderId,
          amount,
          rate_percent: rate,
          status: "unpaid",
        });
      }
    }
  }

  const { data: updated } = await sb.from("orders").select("*").eq("id", orderId).single();
  return updated;
}

async function getOrderByNumber(orderNumber) {
  const sb = supabase();
  const { data: order, error } = await sb
    .from("orders")
    .select("*, barbers(name)")
    .eq("order_number", orderNumber)
    .single();
  if (error || !order) return null;
  const { data: items } = await sb.from("order_items").select("*").eq("order_id", order.id);
  const { shipping, billing } = parseOrderAddresses(order);

  return {
    ...order,
    barber_name: order.barbers?.name,
    shipping,
    billing,
    items: await enrichItemsWithProductImages(items || []),
  };
}

async function countProducts() {
  const { count, error } = await supabase().from("products").select("*", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
}

// ─── Admin ───
async function getAdminByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const { data } = await supabase().from("admin_users").select("*").eq("email", normalized).maybeSingle();
  return data;
}

async function upsertAdmin(email, passwordHash) {
  const normalized = String(email || "").trim().toLowerCase();
  const existing = await getAdminByEmail(normalized);
  if (existing) {
    await supabase().from("admin_users").update({ password_hash: passwordHash }).eq("email", existing.email);
    return existing.id;
  }
  const { data } = await supabase()
    .from("admin_users")
    .insert({ email: normalized, password_hash: passwordHash })
    .select("id")
    .single();
  return data.id;
}

async function clearCatalog() {
  const sb = supabase();
  await sb.from("commissions").delete().gte("id", 0);
  await sb.from("order_items").delete().gte("id", 0);
  await sb.from("referral_codes").delete().gte("id", 0);
  await sb.from("orders").delete().gte("id", 0);
  await sb.from("customers").delete().neq("id", 0);
  await sb.from("product_variants").delete().neq("id", 0);
  await sb.from("product_images").delete().neq("id", 0);
  await sb.from("products").delete().neq("id", 0);
  await sb.from("categories").delete().neq("id", 0);
  await sb.from("barbers").delete().neq("id", 0);
  await sb.from("site_content").delete().neq("key", "");
}

/** Removes orders, barbers, customers, and referral data. Keeps products, categories, and site content. */
async function clearDemoData() {
  const sb = supabase();
  await sb.from("commissions").delete().gte("id", 0);
  await sb.from("order_items").delete().gte("id", 0);
  await sb.from("orders").update({ referral_code_id: null, barber_id: null }).neq("id", 0);
  await sb.from("referral_codes").delete().gte("id", 0);
  await sb.from("orders").delete().gte("id", 0);
  await sb.from("customers").delete().neq("id", 0);
  await sb.from("barbers").delete().neq("id", 0);
  await sb.from("admin_users").delete().neq("id", 0);
}

async function insertCategory(c) {
  const { data, error } = await supabase().from("categories").insert(c).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function insertProduct(p) {
  const { data, error } = await supabase().from("products").insert(p).select().single();
  if (error) throw error;
  return data;
}

async function insertProductImage(img) {
  const row = {
    product_id: img.product_id,
    url: img.url,
    sort_order: img.sort_order ?? 0,
    is_hover: !!img.is_hover,
  };
  const { data, error } = await supabase().from("product_images").insert(row).select().single();
  if (error) throw error;
  return data;
}

async function insertVariant(v) {
  const row = {
    product_id: v.product_id,
    size: v.size,
    color: v.color,
    stock: v.stock,
    sku: v.sku || null,
  };
  const { data, error } = await supabase().from("product_variants").insert(row).select().single();
  if (error) throw error;
  return data;
}

async function insertSiteContent(key, value) {
  await supabase().from("site_content").upsert({ key, value });
}

async function insertBarber(b) {
  const { data, error } = await supabase().from("barbers").insert(b).select().single();
  if (error) throw error;
  return data;
}

async function insertReferralCode(barberId, code) {
  await supabase().from("referral_codes").insert({ barber_id: barberId, code });
}

async function getAllProductsAdmin() {
  const { data: products } = await supabase().from("products").select("*").order("created_at", { ascending: false });
  const result = [];
  for (const p of products || []) {
    const { data: variants } = await supabase().from("product_variants").select("*").eq("product_id", p.id);
    const { data: images } = await supabase()
      .from("product_images")
      .select("*")
      .eq("product_id", p.id)
      .order("sort_order");
    result.push({ ...p, variants: variants || [], images: images || [] });
  }
  return result;
}

async function enrichItemsWithProductImages(items) {
  if (!items?.length) return [];
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const imageByProduct = {};
  if (productIds.length) {
    const { data: images } = await supabase()
      .from("product_images")
      .select("product_id, url, sort_order")
      .in("product_id", productIds)
      .order("sort_order");
    for (const img of images || []) {
      if (!imageByProduct[img.product_id]) imageByProduct[img.product_id] = img.url;
    }
  }
  return items.map((item) => ({
    ...item,
    image: imageByProduct[item.product_id] || null,
  }));
}

async function getAllOrdersAdmin() {
  const { data: orders } = await supabase().from("orders").select("*, barbers(name)").order("created_at", { ascending: false });
  const out = [];
  for (const o of orders || []) {
    const { data: items } = await supabase().from("order_items").select("*").eq("order_id", o.id);
    const { shipping, billing } = parseOrderAddresses(o);
    out.push({
      ...o,
      barber_name: o.barbers?.name,
      shipping,
      billing,
      items: await enrichItemsWithProductImages(items || []),
    });
  }
  return out;
}

async function getOrderAdmin(id) {
  const { data: o } = await supabase().from("orders").select("*, barbers(name)").eq("id", id).single();
  if (!o) return null;
  const { data: items } = await supabase().from("order_items").select("*").eq("order_id", id);
  const { shipping, billing } = parseOrderAddresses(o);
  return {
    ...o,
    barber_name: o.barbers?.name,
    shipping,
    billing,
    items: await enrichItemsWithProductImages(items || []),
  };
}

async function updateOrderStatus(id, status) {
  await supabase().from("orders").update({ status }).eq("id", id);
}

async function createProduct(body) {
  const { data, error } = await supabase().from("products").insert(body).select().single();
  if (error) throw error;
  return data;
}

async function updateProduct(id, body) {
  await supabase().from("products").update({ ...body, updated_at: new Date().toISOString() }).eq("id", id);
}

async function deleteProduct(id) {
  await supabase().from("products").delete().eq("id", id);
}

async function addProductImage(productId, url, sortOrder, isHover) {
  const { data } = await supabase()
    .from("product_images")
    .insert({ product_id: productId, url, sort_order: sortOrder, is_hover: isHover })
    .select()
    .single();
  return data;
}

async function deleteProductImage(id) {
  const { data } = await supabase().from("product_images").select("url").eq("id", id).single();
  await supabase().from("product_images").delete().eq("id", id);
  return data;
}

async function addVariant(productId, v) {
  const { data } = await supabase()
    .from("product_variants")
    .insert({ product_id: productId, ...v })
    .select()
    .single();
  return data;
}

async function updateVariant(id, v) {
  await supabase().from("product_variants").update(v).eq("id", id);
}

async function deleteVariant(id) {
  await supabase().from("product_variants").delete().eq("id", id);
}

async function getCategoriesAdmin() {
  return getCategories();
}

async function insertCategoryAdmin(c) {
  return insertCategory(c);
}

async function updateSiteContent(updates) {
  for (const [key, value] of Object.entries(updates)) {
    await supabase().from("site_content").upsert({ key, value });
  }
}

function barberIdValue(barberId) {
  const n = Number(barberId);
  return Number.isFinite(n) ? n : barberId;
}

async function fetchBarberPerformance(barberId) {
  const id = barberIdValue(barberId);
  const sb = supabase();

  const { data: barber, error: barberErr } = await sb.from("barbers").select("*").eq("id", id).maybeSingle();
  if (barberErr) throw new Error(barberErr.message);
  if (!barber) throw new Error("Barber not found");

  const { data: codes, error: codesErr } = await sb
    .from("referral_codes")
    .select("id, code, used_at, order_id, created_at")
    .eq("barber_id", id)
    .order("created_at", { ascending: false });
  if (codesErr) throw new Error(codesErr.message);

  const { data: directOrders, error: ordersErr } = await sb
    .from("orders")
    .select("*")
    .eq("barber_id", id)
    .eq("payment_status", "paid")
    .order("created_at", { ascending: false });
  if (ordersErr) throw new Error(ordersErr.message);

  const linkedOrderIds = [
    ...new Set((codes || []).map((c) => c.order_id).filter((oid) => oid != null)),
  ];
  let linkedOrders = [];
  if (linkedOrderIds.length) {
    const { data, error: linkedErr } = await sb
      .from("orders")
      .select("*")
      .in("id", linkedOrderIds)
      .eq("payment_status", "paid");
    if (linkedErr) throw new Error(linkedErr.message);
    linkedOrders = data || [];
  }

  const ordersById = new Map();
  for (const o of [...(directOrders || []), ...linkedOrders]) ordersById.set(o.id, o);
  const orders = [...ordersById.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const { data: commissions, error: commErr } = await sb
    .from("commissions")
    .select("*")
    .eq("barber_id", id)
    .order("created_at", { ascending: false });
  if (commErr) throw new Error(commErr.message);

  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))];
  let customers = [];
  if (customerIds.length) {
    const { data, error: custErr } = await sb.from("customers").select("*").in("id", customerIds);
    if (custErr) throw new Error(custErr.message);
    customers = data || [];
  }

  const stats = {
    total_orders: orders.length,
    total_sales: orders.reduce((s, o) => s + Number(o.total), 0),
    unpaid_commissions: (commissions || [])
      .filter((c) => c.status === "unpaid")
      .reduce((s, c) => s + Number(c.amount), 0),
    paid_commissions: (commissions || [])
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + Number(c.amount), 0),
  };

  return {
    barber,
    referralCodes: codes || [],
    orders,
    commissions: commissions || [],
    customers,
    stats,
  };
}

async function getAllBarbersAdmin() {
  const { data: barbers, error } = await supabase().from("barbers").select("*").order("name");
  if (error) throw new Error(error.message);
  const result = [];
  for (const b of barbers || []) {
    const perf = await fetchBarberPerformance(b.id);
    result.push({
      ...b,
      referralCodes: perf.referralCodes,
      stats: perf.stats,
    });
  }
  return result;
}

async function createBarber(body) {
  const { data } = await supabase().from("barbers").insert(body).select().single();
  return data;
}

async function updateBarber(id, body) {
  const { error } = await supabase()
    .from("barbers")
    .update({
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      commission_rate: body.commission_rate,
      active: body.active,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function deleteBarber(id) {
  const sb = supabase();
  await sb.from("commissions").delete().eq("barber_id", id);
  await sb.from("orders").update({ referral_code_id: null, barber_id: null }).eq("barber_id", id);
  await sb.from("referral_codes").delete().eq("barber_id", id);
  const { data, error } = await sb.from("barbers").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Barber not found");
}

async function generateReferralCodes(barberId, count) {
  const { v4: uuidv4 } = require("uuid");
  const created = [];
  for (let i = 0; i < count; i++) {
    const code = `UK-${uuidv4().split("-")[0].toUpperCase()}`;
    const { error } = await supabase().from("referral_codes").insert({ barber_id: barberId, code });
    if (!error) created.push(code);
    else i--;
  }
  return created;
}

async function getBarberDashboard(barberId) {
  const perf = await fetchBarberPerformance(barberId);
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
  await supabase()
    .from("commissions")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id);
}

async function payAllCommissions(barberId) {
  await supabase()
    .from("commissions")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("barber_id", barberId)
    .eq("status", "unpaid");
}

async function updateOrderStripeSession(orderId, sessionId) {
  await supabase().from("orders").update({ stripe_session_id: sessionId }).eq("id", orderId);
}

async function getOrderItemsForCheckout(orderId) {
  const { data } = await supabase()
    .from("order_items")
    .select("*, product_images(url)")
    .eq("order_id", orderId);
  return data;
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
  mapProduct,
};
