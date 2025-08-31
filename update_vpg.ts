// update_vpg.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts"; // <-- Load .env
import { parse } from "https://deno.land/x/xml@2.0.4/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FEED_URL = Deno.args[0];
const SOURCE_FEED_ID = Deno.env.get("SOURCE_FEED_ID");

if (!FEED_URL || !SOURCE_FEED_ID) {
  console.error("❌ Missing required FEED_URL or SOURCE_FEED_ID");
  Deno.exit(1);
}

// --- HELPERS --- //
const cleanVpgModelName = (rawName: string, description: string, brand: string): string => {
  let name = description || rawName || "";
  const brandRegex = new RegExp(`^${brand}\\s*-?\\s*`, "i");
  name = name.replace(brandRegex, "").trim();
  name = name.replace(/\b(men'?s|women'?s|w'?s|m'?s|male|female|unisex|dam|herre)\b/gi, "");
  name = name.replace(/\s?(EU\s?\d+|UK\s?\d+(?:[,.]\d+)?|[A-Z]\/[A-Z]|XXL|XL|L|M|S|XS|One Size)$/gi, "");
  name = name.replace(/\b([1-4]?[0-9])([.,]\d+)?\b$/, "").trim();
  name = name.replace(/\s{2,}/g, " ").trim();
  return name;
};

const normalizeText = (val: unknown): string => {
  if (!val) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return val.toString();
  if (typeof val === "object" && "_text" in val) return (val as any)._text?.trim?.() || "";
  return "";
};

const get = (obj: any, key: string): string => {
  const val = obj?.[key];
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number") return normalizeText(val);
  if (Array.isArray(val)) return normalizeText(val[0]);
  if (typeof val === "object" && "_text" in val) return normalizeText(val._text);
  return "";
};

const extractExtras = (item: any, field: string): string => {
  const names = Array.isArray(item?.Extras?.Name) ? item.Extras.Name : [item?.Extras?.Name].filter(Boolean);
  const values = Array.isArray(item?.Extras?.Value) ? item.Extras.Value : [item?.Extras?.Value].filter(Boolean);
  for (let i = 0; i < names.length; i++) {
    const name = normalizeText(names[i]);
    if (name.toLowerCase() === field.toLowerCase()) {
      return normalizeText(values[i]);
    }
  }
  return "";
};

const fetchRetailerId = async (): Promise<string> => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/retailer_product_feeds?select=retailer_id&id=eq.${SOURCE_FEED_ID}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

  const json = await res.json();
  const retailer_id = json?.[0]?.retailer_id;
  if (!retailer_id) throw new Error(`❌ Could not find retailer_id for SOURCE_FEED_ID: ${SOURCE_FEED_ID}`);
  return retailer_id;
};

const getSubcategoryIdFromRawCategory = async (rawCategory: string): Promise<string | null> => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/raw_category_subcategory_map?select=subcategory_id&raw_category=eq.${encodeURIComponent(rawCategory)}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0]?.subcategory_id || null;
};

// --- FETCH & PARSE --- //
console.log("🔄 Downloading VPG feed...");
const res = await fetch(FEED_URL);
if (!res.ok) throw new Error("❌ Feed fetch failed");

const xml = await res.text();
const parsed = parse(xml);
const rawItems = parsed?.productFeed?.product;
if (!rawItems) {
  console.error("❌ No <product> items found.");
  Deno.exit(1);
}
const products = Array.isArray(rawItems) ? rawItems : [rawItems];
console.log(`📦 Found ${products.length} products`);

const sourceRetailerId = await fetchRetailerId();

for (const item of products) {
  const rawName = get(item, "Name");
  const brand = get(item, "Brand");
  const description = get(item, "Description");
  const color = extractExtras(item, "color");
  const size = extractExtras(item, "size");
  const rawCategory = get(item, "Category");
  const subcategory_id = await getSubcategoryIdFromRawCategory(rawCategory);

  const modelName = cleanVpgModelName(rawName, description, brand);

  const updatePayload = {
    sku: get(item, "SKU"),
    model_name: modelName,
    brand,
    price: parseFloat(get(item, "Price")) || 0,
    original_price: parseFloat(get(item, "OriginalPrice")) || null,
    currency: get(item, "Currency") || "NOK",
    availability: get(item, "Instock") || "unknown",
    product_url: get(item, "ProductUrl"),
    image_url: get(item, "ImageUrl"),
    tracking_url: get(item, "TrackingUrl"),
    ean: get(item, "Ean"),
    manufacturer_article_number: get(item, "ManufacturerArticleNumber"),
    color,
    gender: extractExtras(item, "gender"),
    condition: extractExtras(item, "condition"),
    item_group_id: extractExtras(item, "item_group_id"),
    shipping_weight: extractExtras(item, "shipping_weight"),
    size,
    last_seen_at: new Date().toISOString(),
    description,
    raw_name: rawName,
    raw_category: rawCategory,
    source_feed_id: SOURCE_FEED_ID,
    source_retailer_id: sourceRetailerId,
    subcategory_id,
  };

  console.log(`📤 Upserting SKU: ${updatePayload.sku} | Model: ${updatePayload.model_name}`);

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/product_variants`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!insertRes.ok) {
    const error = await insertRes.text();
    console.warn("❌ Failed:", updatePayload.sku, error);
  } else {
    console.log("✅ Upserted:", updatePayload.sku);
  }
}