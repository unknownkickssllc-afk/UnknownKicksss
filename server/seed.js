require("dotenv").config();
const bcrypt = require("bcryptjs");
const data = require("./data");
const { discoverProductsFromFolder, slugify } = require("./lib/discoverProducts");
const { isSupabaseConfigured } = require("./lib/supabase");

const categories = [
  { name: "Streetwear", slug: "streetwear", sort_order: 1 },
  { name: "Footwear", slug: "footwear", sort_order: 2 },
  { name: "Accessories", slug: "accessories", sort_order: 3 },
];

const defaultContent = {
  hero_tagline: "SS2026 OUT NOW",
  hero_image: "/herov1.png",
  hero_cta_text: "Shop now",
  arrivals_title: "New Arrivals",
  arrivals_subtitle:
    "Available worldwide. Limited drops — join the list for early access.",
  promo_banner: "",
};

async function seed() {
  if (!isSupabaseConfigured()) {
    console.log("Seeding SQLite database…");
  } else {
    console.log("Seeding Supabase database…");
    console.log(process.env.SUPABASE_URL);
  }

  const products = discoverProductsFromFolder();
  console.log(`Found ${products.length} product(s) from /products folder`);

  await data.clearCatalog();

  const email = process.env.ADMIN_EMAIL || "admin@hillwebworks.com";
  const password = process.env.ADMIN_PASSWORD || "HillWebworks2026!";
  const hash = bcrypt.hashSync(password, 10);
  await data.upsertAdmin(email, hash);

  const catIds = {};
  for (const c of categories) {
    const row = await data.insertCategory(c);
    if (!row?.id) throw new Error(`Failed to create category "${c.slug}". Run supabase/schema.sql first.`);
    catIds[c.slug] = row.id;
  }

  for (const p of products) {
    const row = await data.insertProduct({
      name: p.name,
      slug: p.slug,
      description: p.description,
      price: p.price,
      category_id: catIds[p.category],
      sold_out: false,
      size_chart_json: p.sizeChart || [],
      shipping_info:
        p.shippingInfo ||
        "Standard shipping 3–5 business days. Free returns within 14 days on unworn items with tags attached.",
    });
    if (!row?.id) throw new Error(`Failed to create product "${p.slug}".`);

    for (let i = 0; i < p.images.length; i++) {
      const url = p.images[i];
      const isHover =
        p.imageHover && url === p.imageHover
          ? true
          : /hover/i.test(url) || i === 1;
      await data.insertProductImage({
        product_id: row.id,
        url,
        sort_order: i,
        is_hover: isHover && !(p.imagePrimary && url === p.imagePrimary),
      });
    }

    for (const v of p.variants) {
      await data.insertVariant({
        product_id: row.id,
        size: v.size,
        color: v.color,
        stock: v.stock,
        sku: `${p.slug}-${v.size}-${slugify(v.color)}`.toUpperCase(),
      });
    }
  }

  for (const [key, value] of Object.entries(defaultContent)) {
    await data.insertSiteContent(key, value);
  }

  const barber = await data.insertBarber({
    name: "Demo Barber",
    email: "barber@example.com",
    phone: "555-0100",
    commission_rate: 10,
    active: true,
  });

  const codes = ["BARBER-DEMO-001", "BARBER-DEMO-002", "UK-REF-TEST"];
  for (const code of codes) {
    await data.insertReferralCode(barber.id, code);
  }

  const count = await data.countProducts();
  console.log("Seed complete.");
  console.log(`Products in database: ${count}`);
  console.log(`Admin login: ${email} / ${password}`);
  console.log("Demo referral codes:", codes.join(", "));
}

seed().catch((e) => {
  console.error("Seed failed:", e.message);
  if (e.message?.includes("relation") || e.message?.includes("schema.sql") || e.code === "PGRST205") {
    console.error("\n→ Run supabase/schema.sql in your Supabase SQL Editor first:");
    console.error("  https://supabase.com/dashboard/project/fepxpoystmqllibfmgie/sql/new");
  }
  process.exit(1);
});
