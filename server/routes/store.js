const express = require("express");
const data = require("../data");

const router = express.Router();

router.get("/content", async (req, res) => {
  try {
    res.json(await data.getSiteContent());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/categories", async (req, res) => {
  try {
    res.json(await data.getCategories());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/products", async (req, res) => {
  try {
    res.json(await data.getProducts(req.query.category));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/products/:slug", async (req, res) => {
  try {
    const product = await data.getProductBySlug(req.params.slug);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/referral/validate", async (req, res) => {
  try {
    const result = await data.validateReferralCode(req.query.code);
    if (!result) return res.json({ valid: false, error: "Enter a referral code" });
    if (!result.valid) return res.json(result);
    res.json({ valid: true, code: result.code, barberName: result.barberName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
