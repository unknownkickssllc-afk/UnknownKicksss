const fs = require("fs");
const path = require("path");

const APPAREL_SIZES = ["S", "M", "L", "XL"];
const FOOTWEAR_SIZES = ["8", "9", "10", "11", "12"];

const APPAREL_SIZE_CHART = [
  { size: "S", chest: "52", length: "68" },
  { size: "M", chest: "56", length: "70" },
  { size: "L", chest: "60", length: "72" },
  { size: "XL", chest: "64", length: "74" },
];

const DEFAULT_SHIPPING =
  "Standard shipping 3–5 business days. Free returns within 14 days on unworn items with tags attached.";

/** S–XL × each color (for tees, hoodies, jackets, pants, shorts, vests). */
function apparelVariants(colors, baseStock = 8) {
  const variants = [];
  for (const color of colors) {
    for (const size of APPAREL_SIZES) {
      const bump = size === "M" ? 4 : size === "L" ? 2 : 0;
      variants.push({ size, color, stock: baseStock + bump });
    }
  }
  return variants;
}

/** Numeric sizes × each color (sneakers, slides). */
function footwearVariants(colors, sizes = FOOTWEAR_SIZES, baseStock = 6) {
  const variants = [];
  for (const color of colors) {
    for (const size of sizes) {
      variants.push({ size, color, stock: baseStock });
    }
  }
  return variants;
}

/** One size fits all × colors (caps, beanies, socks). */
function osVariants(colors, baseStock = 15) {
  return colors.map((color) => ({ size: "OS", color, stock: baseStock }));
}

/** Names/descriptions match images in public/products/{id}/ (folder id = key). */
const DEFAULT_META = {
  1: {
    name: "UK SIDE-PANEL SHORTS IN BLACK",
    slug: "uk-side-panel-shorts-black",
    description:
      "Lightweight athletic shorts with curved contrast side panels and embroidered leg mark. Elastic waist, relaxed fit. Model is 180cm wearing size M.",
    price: 65,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Black", "White"]),
  },
  2: {
    name: "UK CUSHION CREW SOCKS 4-PACK",
    slug: "uk-cushion-crew-socks-4pack",
    description:
      "Four pairs of cushioned crew socks with knit logo cuff. Fits US shoe sizes 6–12. Sold as one 4-pack.",
    price: 28,
    category: "accessories",
    sizeChart: [],
    shippingInfo: DEFAULT_SHIPPING,
    variants: osVariants(["Black", "White", "Multi"]),
  },
  3: {
    name: "UK VALLEY DREAMS RHINESTONE ZIP HOODIE",
    slug: "uk-valley-dreams-rhinestone-zip-hoodie",
    description:
      "Washed periwinkle full-zip hoodie with crystal embellishments and raised Valley Dreams chest lettering. Cropped boxy fit. Model is 178cm wearing size M.",
    price: 165,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Periwinkle", "Black", "Charcoal"]),
  },
  4: {
    name: "UK VALLEY DREAMS GRAPHIC TEE IN BLACK",
    slug: "uk-valley-dreams-graphic-tee-black",
    description:
      "Oversized vintage-wash tee with Valley Dreams front graphic. Distressed neckline and hem. Short sleeve. Model is 182cm wearing size M.",
    price: 85,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Black", "Charcoal", "White"]),
  },
  5: {
    name: "UK VALLEY DREAMS LONG SLEEVE TEE IN BLACK",
    slug: "uk-valley-dreams-long-sleeve-tee-black",
    description:
      "Long-sleeve vintage-wash tee with Valley Dreams graphic and flame sleeve prints. Boxy fit, raw hem. Model is 185cm wearing size L.",
    price: 95,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Black", "Charcoal", "White"]),
  },
  6: {
    name: "UK ANTI PROMO CHECKER HOODIE IN RED",
    slug: "uk-anti-promo-checker-hoodie-red",
    description:
      "Pullover hoodie in red and black checkerboard with eye-motif squares and Anti Promo chest graphic. Kangaroo pocket, ribbed cuffs. Model is 183cm wearing size L.",
    price: 120,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Red/Black", "Black", "Charcoal"]),
  },
  7: {
    name: "UK RHINESTONE CREST ZIP HOODIE IN CHARCOAL",
    slug: "uk-rhinestone-crest-zip-hoodie-charcoal",
    description:
      "Vintage-wash charcoal zip hoodie with rhinestone scatter and embroidered sport crest patch. Silver ring zip pull. Model is 188cm wearing size M.",
    price: 140,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Charcoal", "Black", "Stone"]),
  },
  8: {
    name: "UK VALE SPORT ZIP HOODIE IN CHARCOAL",
    slug: "uk-vale-sport-zip-hoodie-charcoal",
    description:
      "Washed charcoal zip hoodie with Vale Sport chest branding and scribble-trim hood. Front pockets, distressed rib hem. Model is 186cm wearing size M.",
    price: 95,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Charcoal", "Black", "Navy"]),
  },
  9: {
    name: "UK SAINT VANITY STAR ZIP HOODIE IN BLACK",
    slug: "uk-saint-vanity-star-zip-hoodie-black",
    description:
      "Black zip hoodie with all-over star/rhinestone print and Saint Vanity cherub circle graphic on chest. Full zip, ribbed trim. Model is 184cm wearing size M.",
    price: 110,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Black", "Charcoal", "White"]),
  },
  10: {
    name: "UK VALLEY DREAMS VINTAGE TEE IN CREAM",
    slug: "uk-valley-dreams-vintage-tee-cream",
    description:
      "Cream vintage-wash tee with oversized Valley Dreams movie-poster graphic. Relaxed fit, frayed edges. Model is 180cm wearing size M.",
    price: 55,
    category: "streetwear",
    sizeChart: APPAREL_SIZE_CHART,
    shippingInfo: DEFAULT_SHIPPING,
    variants: apparelVariants(["Cream", "White", "Black"]),
  },
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/**
 * Build product seed data from /products/{id}/* image files.
 */
function discoverProductsFromFolder() {
  const productsDir = path.join(__dirname, "..", "..", "public", "products");
  if (!fs.existsSync(productsDir)) {
    return buildFromMeta(Object.keys(DEFAULT_META));
  }

  const folders = fs
    .readdirSync(productsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

  if (!folders.length) return buildFromMeta(Object.keys(DEFAULT_META));

  return folders.map((folder) => {
    const id = folder;
    const meta = DEFAULT_META[id] || {
      name: `UNKNOWN KICKS PRODUCT ${id}`,
      slug: `uk-product-${id}`,
      description: "Unknown Kicks exclusive drop.",
      price: 99,
      category: "streetwear",
      sizeChart: APPAREL_SIZE_CHART,
      shippingInfo: DEFAULT_SHIPPING,
      variants: apparelVariants(["Black", "White"]),
    };

    const dir = path.join(productsDir, folder);
    const files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    const urls = files.map((f) => `/products/${folder}/${encodeURIComponent(f)}`);
    const hoverFile = files.find((f) => /hover/i.test(f));
    const primaryFile =
      files.find((f) => /^image\.(png|jpe?g|webp)$/i.test(f)) ||
      files.find((f) => !/hover/i.test(f)) ||
      files[0];
    const primary = primaryFile
      ? `/products/${folder}/${encodeURIComponent(primaryFile)}`
      : urls[0];
    const hover = hoverFile
      ? `/products/${folder}/${encodeURIComponent(hoverFile)}`
      : urls[1] || primary;

    const images = [];
    if (primary) images.push(primary);
    if (hover && hover !== primary) images.push(hover);
    for (const u of urls) {
      if (!images.includes(u)) images.push(u);
    }

    return {
      ...meta,
      folderId: id,
      images: images.length ? images : [`/products/${folder}/image.png`],
      imagePrimary: primary,
      imageHover: hover,
    };
  });
}

function buildFromMeta(keys) {
  return keys.map((id) => {
    const meta = DEFAULT_META[id];
    return {
      ...meta,
      folderId: id,
      images: [`/products/${id}/image.png`],
    };
  });
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

module.exports = {
  discoverProductsFromFolder,
  slugify,
  DEFAULT_META,
  APPAREL_SIZES,
  apparelVariants,
};
