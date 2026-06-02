const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const data = require("../data");
const { authenticateAdminPin } = require("../lib/adminAuth");
const { requireAdmin } = require("../middleware/auth");
const {
  deleteRemoteUpload,
  uploadPublicImage,
  usesRemoteStorage,
} = require("../lib/uploadStorage");
const { validateProductPayload } = require("../lib/validateProduct");

const router = express.Router();

const uploadsRoot = path.join(__dirname, "..", "..", "public", "uploads");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, "products");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname) || ".jpg"}`);
  },
});
const upload = multer({
  storage: usesRemoteStorage() ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

async function persistUpload(file, folder = "products") {
  if (usesRemoteStorage()) {
    return uploadPublicImage(file, folder);
  }
  return `/uploads/products/${file.filename}`;
}

router.post("/login", (req, res) => {
  const code =
    req.body?.code ??
    req.body?.pin ??
    req.body?.accessCode ??
    req.body?.password;
  const result = authenticateAdminPin(code);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  req.session.adminAuthenticated = true;
  res.json({ success: true });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});

router.get("/me", (req, res) => {
  if (!req.session?.adminAuthenticated) return res.status(401).json({ error: "Unauthorized" });
  res.json({ authenticated: true });
});

router.get("/products", requireAdmin, async (req, res) => {
  try {
    res.json(await data.getAllProductsAdmin());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/products", requireAdmin, async (req, res) => {
  try {
    const { name, slug, description, price, category_id, sold_out, shipping_info } = req.body;
    const err = validateProductPayload(
      { name, description, price, category_id },
      { isCreate: true }
    );
    if (err) return res.status(400).json({ error: err });
    const p = await data.createProduct({
      name: String(name).trim(),
      slug: String(slug || "").trim() || String(name).trim().toLowerCase().replace(/\s+/g, "-"),
      description: String(description).trim(),
      price,
      category_id,
      sold_out: !!sold_out,
      shipping_info: shipping_info || "",
    });
    res.json({ id: p.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/products/:id", requireAdmin, async (req, res) => {
  try {
    const err = validateProductPayload(req.body);
    if (err) return res.status(400).json({ error: err });
    await data.updateProduct(req.params.id, {
      ...req.body,
      name: String(req.body.name || "").trim(),
      slug: String(req.body.slug || "").trim(),
      description: String(req.body.description ?? "").trim(),
      shipping_info: String(req.body.shipping_info ?? "").trim(),
      category_id: req.body.category_id,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/products/:id", requireAdmin, async (req, res) => {
  try {
    await data.deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/products/:id/images", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const url = await persistUpload(req.file);
    const img = await data.addProductImage(
      req.params.id,
      url,
      parseInt(req.body.sort_order, 10) || 0,
      !!req.body.is_hover
    );
    res.json({ id: img.id, url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/product-images/:id", requireAdmin, async (req, res) => {
  try {
    const img = await data.deleteProductImage(req.params.id);
    if (img?.url?.startsWith("/uploads/")) {
      const fp = path.join(__dirname, "..", "..", img.url.replace(/^\//, ""));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } else if (img?.url) {
      await deleteRemoteUpload(img.url);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/products/:id/variants", requireAdmin, async (req, res) => {
  try {
    const { size, color, stock, sku } = req.body;
    const v = await data.addVariant(req.params.id, { size, color, stock, sku: sku || null });
    res.json({ id: v.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/variants/:id", requireAdmin, async (req, res) => {
  try {
    await data.updateVariant(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/variants/:id", requireAdmin, async (req, res) => {
  try {
    await data.deleteVariant(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/categories", requireAdmin, async (req, res) => {
  try {
    res.json(await data.getCategoriesAdmin());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/categories", requireAdmin, async (req, res) => {
  try {
    const { name, slug, sort_order } = req.body;
    const c = await data.insertCategoryAdmin({ name, slug, sort_order: sort_order || 0 });
    res.json({ id: c.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/content", requireAdmin, async (req, res) => {
  try {
    res.json(await data.getSiteContent());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/content", requireAdmin, async (req, res) => {
  try {
    await data.updateSiteContent(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/content/upload", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const url = await persistUpload(req.file, "site");
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/orders", requireAdmin, async (req, res) => {
  try {
    res.json(await data.getAllOrdersAdmin());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/orders/:id", requireAdmin, async (req, res) => {
  try {
    const o = await data.getOrderAdmin(req.params.id);
    if (!o) return res.status(404).json({ error: "Not found" });
    res.json(o);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    await data.updateOrderStatus(req.params.id, req.body.status);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/barbers", requireAdmin, async (req, res) => {
  try {
    res.json(await data.getAllBarbersAdmin());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/barbers", requireAdmin, async (req, res) => {
  try {
    const { name, email, phone, commission_rate, active } = req.body;
    const b = await data.createBarber({
      name,
      email,
      phone,
      commission_rate: commission_rate ?? 10,
      active: active !== false,
    });
    res.json({ id: b.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/barbers/:id", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    await data.updateBarber(req.params.id, {
      name,
      email: req.body.email,
      phone: req.body.phone,
      commission_rate: req.body.commission_rate,
      active: req.body.active !== false,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/barbers/:id", requireAdmin, async (req, res) => {
  try {
    await data.deleteBarber(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/barbers/:id/codes", requireAdmin, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count, 10) || 1, 50);
    const codes = await data.generateReferralCodes(req.params.id, count);
    res.json({ codes });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/barbers/:id/dashboard", requireAdmin, async (req, res) => {
  try {
    res.json(await data.getBarberDashboard(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/commissions/:id/pay", requireAdmin, async (req, res) => {
  try {
    await data.payCommission(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/commissions/pay-all/:barberId", requireAdmin, async (req, res) => {
  try {
    await data.payAllCommissions(req.params.barberId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
