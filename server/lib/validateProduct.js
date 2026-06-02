function validateProductPayload(body, { isCreate = false } = {}) {
  const name = String(body.name || "").trim();
  if (!name) return "Product name is required";

  if (!body.category_id) return "Category is required";

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return "Valid price is required";

  const description = String(body.description ?? "").trim();
  if (!description) return "Description is required";

  if (!isCreate) {
    const slug = String(body.slug || "").trim();
    if (!slug) return "Product URL slug is required";
    const shipping = String(body.shipping_info ?? "").trim();
    if (!shipping) return "Shipping info is required";
  }

  return null;
}

module.exports = { validateProductPayload };
