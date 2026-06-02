async function validateCartItems(items, getVariant) {
  const validated = [];
  let subtotal = 0;

  for (const item of items) {
    const variant = await getVariant(item.variantId);
    if (!variant) throw new Error(`Invalid variant: ${item.variantId}`);
    if (variant.sold_out) throw new Error(`${variant.product_name} is sold out`);
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    if (variant.stock < qty) {
      throw new Error(
        `Insufficient stock for ${variant.product_name} (${variant.size}/${variant.color}). Only ${variant.stock} left.`
      );
    }
    const lineTotal = variant.price * qty;
    subtotal += lineTotal;
    validated.push({
      variantId: variant.id,
      productId: variant.product_id,
      productName: variant.product_name,
      size: variant.size,
      color: variant.color,
      quantity: qty,
      unitPrice: variant.price,
      lineTotal,
      image: item.image || null,
    });
  }

  if (validated.length === 0) throw new Error("Cart is empty");
  return { items: validated, subtotal, total: subtotal };
}

module.exports = { validateCartItems };
