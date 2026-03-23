<h2 align="center">Option B Implementation Guide — Helix as the Hub</h2>

<p align="center">
  <em>Complete specification for converting Card Yeti Sync from Shopify-as-source (Option A) to Helix-as-source (Option B)</em>
</p>

---

**Date:** March 2026
**Prerequisite:** Helix Seller API (see `docs/HELIX_PROPOSAL.md` for proposed spec)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Helix API Client & OAuth](#2-helix-api-client--oauth)
3. [Helix Adapter](#3-helix-adapter)
4. [New Shopify Write Mutations](#4-new-shopify-write-mutations)
5. [Reverse Mapper (Helix → Shopify)](#5-reverse-mapper-helix--shopify)
6. [Inbound Webhook Handler](#6-inbound-webhook-handler)
7. [Sync Engine Refactor](#7-sync-engine-refactor)
8. [Echo Loop Prevention](#8-echo-loop-prevention)
9. [Database Schema Changes](#9-database-schema-changes)
10. [Existing Webhook Handler Changes](#10-existing-webhook-handler-changes)
11. [Dashboard & UI Updates](#11-dashboard--ui-updates)
12. [Reconciliation Cron Updates](#12-reconciliation-cron-updates)
13. [Files to Create/Modify](#13-files-to-createmodify)
14. [Implementation Sequence](#14-implementation-sequence)

---

## 1. Overview

### Current Architecture (Option A)

Shopify is the source of truth. Products flow outward to marketplaces:

```
Shopify (source of truth)
  │
  │  webhooks: products/create, products/update,
  │            orders/create, inventory_levels/update
  ▼
┌──────────────────────────────┐
│     Card Yeti Sync App       │
│                              │
│  sync-engine.server.ts       │
│  ├─ createEbayListing()      │  ← hardcoded to eBay
│  ├─ delistFromAllExcept()    │
│  └─ relistAll()              │
│                              │
│  Adapters (push-only)        │
│  ├─ eBay    (Sell API)       │
│  ├─ Whatnot (CSV export)     │
│  └─ Helix   (CSV export)    │
└──────────────────────────────┘
  │
  ▼
eBay / Whatnot / Helix (destinations)
```

### Target Architecture (Option B)

Helix becomes the source of truth. Products flow inward from Helix, then outward to Shopify and other marketplaces:

```
Helix (source of truth)
  │
  │  webhooks: listing.created, listing.updated,
  │            order.created, listing.status_changed
  ▼
┌──────────────────────────────────────────────────┐
│              Card Yeti Sync App                   │
│                                                   │
│  Helix Client (new)                              │
│  ├─ fetchListings()      READ from Helix         │
│  ├─ fetchListing()                               │
│  ├─ updateInventory()    WRITE to Helix          │
│  └─ delistProduct()                              │
│                                                   │
│  Sync Engine (refactored)                        │
│  ├─ syncHelixToShopify()        NEW              │
│  ├─ syncHelixToMarketplaces()   NEW              │
│  ├─ delistFromAllExcept()       UPDATED          │
│  └─ relistAll()                 UNCHANGED        │
│                                                   │
│  Shopify Writer (new)                            │
│  ├─ createProduct()       NEW mutations          │
│  ├─ updateProduct()                              │
│  ├─ setMetafields()                              │
│  └─ setInventory()                               │
│                                                   │
│  Marketplace Adapters (existing)                 │
│  ├─ eBay   (Sell API)    UNCHANGED               │
│  └─ Whatnot (CSV)        UNCHANGED               │
└──────────────────────────────────────────────────┘
  │                    │
  ▼                    ▼
Shopify (destination)  eBay / Whatnot (destinations)
```

### What Changes

| Layer | Current (Option A) | Target (Option B) |
|-------|-------------------|-------------------|
| **Source of truth** | Shopify | Helix |
| **Sync trigger** | Shopify webhooks | Helix webhooks |
| **Shopify role** | Source (read-only) | Destination (read + write) |
| **Product creation** | Manual in Shopify | App creates from Helix data |
| **Inventory authority** | Shopify inventory counts | Helix inventory status |
| **Price authority** | Shopify variant prices | Helix listing prices |
| **eBay adapter** | Unchanged | Unchanged (still pushes from app) |
| **Whatnot adapter** | Unchanged | Unchanged (still CSV export) |

---

## 2. Helix API Client & OAuth

### New file: `app/lib/helix-client.server.ts`

Mirrors the existing eBay client pattern (`app/lib/ebay-client.server.ts`). Key differences: Helix uses standard OAuth 2.0 (vs eBay's custom flow) and JSON request/response throughout.

### Environment Variables

```
HELIX_CLIENT_ID        # OAuth app client ID
HELIX_CLIENT_SECRET    # OAuth app secret
HELIX_API_URL          # e.g. https://api.helix.gg/api/v1
HELIX_REDIRECT_URI     # e.g. https://card-yeti-sync.fly.dev/api/helix-callback
```

### Functions

```typescript
// Build Helix OAuth consent URL
function getAuthorizationUrl(state: string): string

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}>

// Refresh expired access token
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}>

// Authenticated API call with reactive 401 refresh (same pattern as ebayApiCall)
async function helixApiCall(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  account: MarketplaceAccount,
): Promise<{ response: Response; updatedTokens: TokenUpdate | null }>
```

### OAuth Flow Routes

**New file: `app/routes/api.helix-callback.tsx`**

Same HMAC-signed state + nonce pattern as `app/routes/api.ebay-callback.tsx`:
1. Validate HMAC state parameter
2. Check nonce hasn't expired or been reused (`OAuthNonce` model)
3. Exchange code for tokens
4. Upsert `MarketplaceAccount` with `marketplace: "helix"`
5. Register Helix webhooks (see section 6)
6. Redirect back to `/app/helix`

---

## 3. Helix Adapter

### New file: `app/lib/adapters/helix.server.ts`

Unlike the eBay adapter which is write-only, the Helix adapter needs **read** operations (to pull listings) and **write** operations (to update inventory when Shopify sales occur).

### Read Operations (Helix → App)

```typescript
// Fetch all active listings from Helix for this seller
async function fetchListings(
  account: MarketplaceAccount,
  options?: { page?: number; perPage?: number },
): Promise<{ listings: HelixListing[]; hasMore: boolean }>

// Fetch a single listing by ID
async function fetchListing(
  listingId: string,
  account: MarketplaceAccount,
): Promise<HelixListing | null>

// Fetch current inventory/availability for a listing
async function fetchInventory(
  listingId: string,
  account: MarketplaceAccount,
): Promise<{ quantity: number; status: string }>
```

### Write Operations (App → Helix)

```typescript
// Update inventory on Helix (e.g., after Shopify sale)
async function updateInventory(
  listingId: string,
  quantity: number,
  account: MarketplaceAccount,
): Promise<{ success: boolean; error?: string }>

// Delist/remove on Helix (e.g., product sold on Shopify)
async function delistProduct(
  listingId: string,
  account: MarketplaceAccount,
): Promise<{ status: "delisted" | "error"; error?: string }>
```

### Helix Listing Type

Based on the proposed listing schema from `docs/HELIX_PROPOSAL.md`:

```typescript
interface HelixListing {
  id: string;                    // Helix listing ID (e.g. "lst_xyz789")
  title: string;
  description: string;
  price_cents: number;
  listing_type: "fixed_price" | "bid_ask" | "escrow_trade";
  condition: "graded" | "raw" | "sealed";
  quantity: number;
  images: string[];
  card: {
    pokemon: string;
    set_name: string;
    card_number: string;
    language: string;
    year: number;
    rarity: string;
    grading: {
      company: string;
      grade: string;
      cert_number: string;
      cert_url: string;
      population: number;
      pop_higher: number;
      subgrades: Record<string, number> | null;
    } | null;
    raw_condition: {
      condition: string;
      centering: string;
      notes: string;
    } | null;
  };
  external_refs: {
    shopify_product_id?: string;
    ebay_item_id?: string;
    source_sku?: string;
  };
  status: "active" | "sold" | "delisted" | "pending";
  created_at: string;
  updated_at: string;
}
```

---

## 4. New Shopify Write Mutations

### Current state

The app currently has **one Shopify mutation**: `productVariantsBulkUpdate` (used in `app/routes/api.prices.tsx` and `app/lib/approve-price.server.ts`) which can only update `price` and `compareAtPrice` on existing variants.

### New file: `app/lib/shopify-writer.server.ts`

All new Shopify write operations needed for Option B:

### 4.1 Create Product

```graphql
mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
  productCreate(input: $input, media: $media) {
    product {
      id
      title
      handle
      variants(first: 1) {
        edges {
          node {
            id
            inventoryItem { id }
          }
        }
      }
    }
    userErrors { field message }
  }
}
```

**ProductInput fields to set:**
- `title` — from Helix listing title
- `descriptionHtml` — from Helix listing description
- `productType` — derived from `condition` ("Graded Card" / "Raw Single" / "Sealed Product")
- `vendor` — "Card Yeti" (or configurable)
- `status` — `ACTIVE`
- `tags` — `["helix-synced"]` (used for echo loop prevention, see section 8)
- `variants` — single variant with price, SKU, inventory tracking

### 4.2 Update Product

```graphql
mutation productUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id }
    userErrors { field message }
  }
}
```

Used when a Helix listing is updated — syncs title, description, price, status changes to the existing Shopify product.

### 4.3 Set Metafields (Batch)

```graphql
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}
```

**MetafieldsSetInput per field:**
```typescript
{
  ownerId: "gid://shopify/Product/123456",
  namespace: "card",
  key: "pokemon",        // one of the 19 card metafield keys
  value: "Charizard",
  type: "single_line_text_field"
}
```

All 19 metafield keys from the existing `CARD_METAFIELD_KEYS` array in `app/lib/shopify-helpers.server.ts`:
```
pokemon, set_name, number, rarity, year, language,
condition, condition_notes, centering,
grading_company, grade, cert_number, population, pop_higher, subgrades,
ebay_comp, cert_url, type_label, ebay_item_id
```

### 4.4 Set Inventory Quantity

```graphql
mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { reason }
    userErrors { field message }
  }
}
```

**Input structure:**
```typescript
{
  name: "available",
  reason: "correction",
  quantities: [{
    inventoryItemId: "gid://shopify/InventoryItem/...",
    locationId: "gid://shopify/Location/...",  // shop's primary location
    quantity: 1  // from Helix listing quantity
  }]
}
```

**Note:** Need to query the shop's primary location ID on first use and cache it. Query:
```graphql
query shopLocations {
  locations(first: 1) {
    edges { node { id name } }
  }
}
```

### 4.5 Create Product Media (Images)

```graphql
mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { id status }
    mediaUserErrors { field message }
  }
}
```

**CreateMediaInput per image:**
```typescript
{
  originalSource: "https://helix-cdn.example.com/image.jpg",  // Helix image URL
  mediaContentType: "IMAGE"
}
```

### 4.6 Function Signatures

```typescript
// Create a new Shopify product from Helix listing data
async function createShopifyProduct(
  admin: AdminClient,
  listing: HelixListing,
  metafields: MetafieldsSetInput[],
): Promise<{ productId: string; variantId: string; inventoryItemId: string }>

// Update an existing Shopify product from Helix listing data
async function updateShopifyProduct(
  admin: AdminClient,
  shopifyProductId: string,
  listing: HelixListing,
): Promise<void>

// Write all 19 card metafields to a Shopify product
async function setProductMetafields(
  admin: AdminClient,
  shopifyProductId: string,
  metafields: CardMetafields,
): Promise<void>

// Set inventory quantity for a product variant
async function setInventoryQuantity(
  admin: AdminClient,
  inventoryItemId: string,
  locationId: string,
  quantity: number,
): Promise<void>

// Upload images from Helix CDN to Shopify product
async function setProductImages(
  admin: AdminClient,
  shopifyProductId: string,
  imageUrls: string[],
): Promise<void>

// Get shop's primary location (cached after first call)
async function getShopLocationId(admin: AdminClient): Promise<string>
```

---

## 5. Reverse Mapper (Helix → Shopify)

### New file: `app/lib/mappers/helix-to-shopify-mapper.ts`

Transforms a Helix listing into Shopify product inputs and card metafields. This is the reverse of the existing `app/lib/mappers/helix-mapper.ts` which maps Shopify → Helix CSV.

### Field Mapping Table

| Helix Listing Field | Shopify Field / Metafield | Transform |
|---------------------|--------------------------|-----------|
| `title` | `product.title` | Direct |
| `description` | `product.descriptionHtml` | Direct |
| `price_cents` | `variant.price` | Divide by 100, format as string |
| `condition` | `product.productType` | `"graded"` → `"Graded Card"`, `"raw"` → `"Raw Single"`, `"sealed"` → `"Sealed Product"` |
| `quantity` | `inventoryQuantity` | Direct (via `inventorySetQuantities` mutation) |
| `images[]` | `product.media` | Direct (URLs passed to `productCreateMedia`) |
| `card.pokemon` | metafield `card.pokemon` | Direct |
| `card.set_name` | metafield `card.set_name` | Direct |
| `card.card_number` | metafield `card.number` | Direct |
| `card.language` | metafield `card.language` | Direct |
| `card.year` | metafield `card.year` | Integer to string |
| `card.rarity` | metafield `card.rarity` | Direct |
| `card.grading.company` | metafield `card.grading_company` | Direct |
| `card.grading.grade` | metafield `card.grade` | Direct |
| `card.grading.cert_number` | metafield `card.cert_number` | Direct |
| `card.grading.cert_url` | metafield `card.cert_url` | Direct |
| `card.grading.population` | metafield `card.population` | Number to string |
| `card.grading.pop_higher` | metafield `card.pop_higher` | Number to string |
| `card.grading.subgrades` | metafield `card.subgrades` | JSON stringify |
| `card.raw_condition.condition` | metafield `card.condition` | Direct |
| `card.raw_condition.centering` | metafield `card.centering` | Direct |
| `card.raw_condition.notes` | metafield `card.condition_notes` | Direct |
| `condition` | metafield `card.type_label` | `"graded"` → `"Graded Slab"`, `"raw"` → `"Raw Single"`, `"sealed"` → `"Sealed Product"` |
| `external_refs.ebay_item_id` | metafield `card.ebay_item_id` | Direct |
| `external_refs.source_sku` | `variant.sku` | Direct |

### Functions

```typescript
// Convert Helix listing to Shopify ProductInput
function mapHelixToProductInput(listing: HelixListing): {
  title: string;
  descriptionHtml: string;
  productType: string;
  tags: string[];
  variants: [{ price: string; sku: string }];
}

// Convert Helix listing card data to Shopify metafields array
function mapHelixToCardMetafields(
  listing: HelixListing,
  shopifyProductId: string,
): MetafieldsSetInput[]

// Convert Helix listing to CardMetafields (flat object, for downstream mappers)
function mapHelixToCardMetafieldValues(listing: HelixListing): CardMetafields
```

### Downstream: Helix → eBay

Once a Helix listing is mapped to `CardMetafields`, the existing eBay mapper (`app/lib/mappers/ebay-mapper.ts`) works without changes. The flow is:

```
Helix listing
  → mapHelixToCardMetafieldValues() → CardMetafields
  → mapToInventoryItem()            → eBay inventory item   (existing)
  → mapToOffer()                    → eBay offer            (existing)
```

This reuses all existing eBay mapping logic.

---

## 6. Inbound Webhook Handler

### New file: `app/routes/api.helix-webhooks.tsx`

Receives webhook events from the Helix API. These are **not** Shopify-managed webhooks — they're HTTP POSTs from Helix to our app's custom endpoint.

### Webhook Registration

On OAuth connection (in `api.helix-callback.tsx`), register webhooks with Helix:

```typescript
// Register webhooks with Helix after OAuth
await helixApiCall("POST", "/webhooks", {
  url: "https://card-yeti-sync.fly.dev/api/helix-webhooks",
  events: ["order.created", "listing.status_changed"],
  secret: generatedHmacSecret,  // store in MarketplaceAccount.settings
}, account);
```

### HMAC Verification

Every incoming webhook must be verified against the shared secret:

```typescript
function verifyHelixWebhook(request: Request, secret: string): boolean {
  const signature = request.headers.get("X-Helix-Signature");
  const body = await request.text();
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### Events Handled

#### `order.created` — Card sold on Helix

The critical cross-channel delist event. When a card sells on Helix:

1. Look up `ProductMapping` to find the Shopify product ID
2. Set Shopify inventory to 0 (via `inventorySetQuantities`)
3. Delist from eBay (via existing `delistFromAllExcept()`)
4. Log to `SyncLog`

```typescript
// Payload (from proposal):
{
  event: "order.created",
  data: {
    order_id: "ord_abc123",
    listing_id: "lst_xyz789",
    buyer_id: "usr_...",
    price_cents: 89900,
    created_at: "2026-03-21T15:30:00Z"
  }
}
```

#### `listing.status_changed` — Listing state changed on Helix

Handles various state transitions:

| Old Status | New Status | App Action |
|-----------|-----------|------------|
| `active` | `sold` | Same as `order.created` — delist everywhere |
| `active` | `delisted` | Set Shopify inventory to 0, delist from eBay |
| `delisted` | `active` | Restore Shopify inventory, relist on eBay |
| `pending` | `active` | Create Shopify product if not exists, list on eBay |

```typescript
// Payload (from proposal):
{
  event: "listing.status_changed",
  data: {
    listing_id: "lst_xyz789",
    old_status: "active",
    new_status: "sold",
    reason: "buyer_purchase",
    changed_at: "2026-03-21T15:30:00Z"
  }
}
```

### Webhook Handler Route

```typescript
export const action = async ({ request }: ActionFunctionArgs) => {
  const body = await request.text();

  // Determine which shop this webhook is for (from Helix API headers or payload)
  const helixSellerId = request.headers.get("X-Helix-Seller-Id");

  // Find the MarketplaceAccount for this Helix seller
  const account = await db.marketplaceAccount.findFirst({
    where: { marketplace: "helix", /* match by seller ID in settings */ },
  });

  // Verify HMAC signature
  const secret = (account.settings as any).webhookSecret;
  if (!verifyHelixWebhook(body, signature, secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body);

  switch (event.event) {
    case "order.created":
      await handleHelixOrder(account, event.data);
      break;
    case "listing.status_changed":
      await handleListingStatusChange(account, event.data);
      break;
  }

  return new Response("OK", { status: 200 });
};
```

---

## 7. Sync Engine Refactor

### File: `app/lib/sync-engine.server.ts`

### Current Functions (What Changes)

| Function | Current | Change for Option B |
|----------|---------|-------------------|
| `createEbayListing()` | Creates eBay listing from Shopify product data | **Keep as-is.** Still used, but now called with data sourced from Helix (via metafield values) instead of read from Shopify. |
| `delistFromAllExcept()` | Delists from eBay/Whatnot/Helix, excludes Shopify | **Update.** Add Shopify as a possible delist target (set inventory to 0). Add Helix as a possible exclude value. |
| `relistAll()` | Marks delisted listings as pending | **Update.** Also restore Shopify inventory when relisting. |

### New Functions Needed

#### `syncHelixToShopify()`

The primary new flow — creates or updates a Shopify product from a Helix listing:

```typescript
async function syncHelixToShopify(
  shopId: string,
  admin: AdminClient,
  listing: HelixListing,
): Promise<{ shopifyProductId: string; created: boolean }> {
  // 1. Check if product mapping already exists
  const mapping = await db.productMapping.findUnique({
    where: { shopId_helixListingId: { shopId, helixListingId: listing.id } },
  });

  if (mapping) {
    // Update existing Shopify product
    await updateShopifyProduct(admin, mapping.shopifyProductId, listing);
    await setProductMetafields(admin, mapping.shopifyProductId, mapHelixToCardMetafieldValues(listing));
    return { shopifyProductId: mapping.shopifyProductId, created: false };
  }

  // 2. Create new Shopify product
  const { productId, variantId, inventoryItemId } = await createShopifyProduct(admin, listing, ...);
  await setProductMetafields(admin, productId, mapHelixToCardMetafieldValues(listing));
  await setProductImages(admin, productId, listing.images);
  await setInventoryQuantity(admin, inventoryItemId, locationId, listing.quantity);

  // 3. Create product mapping
  await db.productMapping.create({
    data: { shopId, helixListingId: listing.id, shopifyProductId: productId },
  });

  // 4. Log
  await db.syncLog.create({ ... });

  return { shopifyProductId: productId, created: true };
}
```

#### `syncHelixToAllMarketplaces()`

Full fan-out from Helix to Shopify + eBay:

```typescript
async function syncHelixToAllMarketplaces(
  shopId: string,
  admin: AdminClient,
  listing: HelixListing,
): Promise<void> {
  // 1. Sync to Shopify (create/update product)
  const { shopifyProductId } = await syncHelixToShopify(shopId, admin, listing);

  // 2. Sync to eBay (if connected and rules pass)
  const ebayAccount = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId, marketplace: "ebay" } },
  });

  if (ebayAccount) {
    const metafields = mapHelixToCardMetafieldValues(listing);
    const rules = getSyncRules(ebayAccount);
    // ... evaluate rules, call createEbayListing() or updateProduct()
  }
}
```

#### Updated `delistFromAllExcept()`

Add Shopify as a possible delist target:

```typescript
// In the listing loop, add:
if (listing.marketplace === "shopify") {
  // NEW: Set Shopify inventory to 0 to "delist"
  const mapping = await db.productMapping.findFirst({
    where: { shopId, helixListingId: /* from listing data */ },
  });
  if (mapping) {
    const admin = await getAdminForShop(shopId);
    await setInventoryQuantity(admin, inventoryItemId, locationId, 0);
  }
  delistSuccess = true;
}
```

---

## 8. Echo Loop Prevention

### The Problem

When the app creates a Shopify product from Helix data, Shopify fires a `products/create` webhook. The current webhook handler (`webhooks.products.create.tsx`) would then try to sync that product to eBay — creating a duplicate listing (since the sync engine already pushed to eBay from the Helix source).

Similarly, when the app updates a Shopify product's price from Helix, Shopify fires `products/update`, which would trigger another eBay update.

### Strategy: Tag-Based Detection

Use a Shopify product tag to mark products created/updated by the sync engine:

**Tag:** `helix-synced`

**On product create from Helix:** Add `helix-synced` to the product's tags.

**In webhook handlers:** Check for the tag and skip if present.

```typescript
// In webhooks.products.create.tsx and webhooks.products.update.tsx:
const tags = typeof payload.tags === "string"
  ? payload.tags.split(", ").filter(Boolean)
  : [];

if (tags.includes("helix-synced")) {
  console.log("Product created/updated by Helix sync — skipping marketplace push");
  return new Response();
}
```

### Alternative: Database Lock

For more robust detection, check the `ProductMapping` table:

```typescript
// If this product was created from Helix, skip outbound sync
const mapping = await db.productMapping.findFirst({
  where: { shopId: shop, shopifyProductId: productGid },
});

if (mapping) {
  console.log("Product originates from Helix — skipping outbound sync");
  return new Response();
}
```

**Recommendation:** Use both — tag for fast path, DB check as fallback. The tag prevents the webhook handler from even querying the database in the common case.

---

## 9. Database Schema Changes

### File: `prisma/schema.prisma`

### New Model: `ProductMapping`

Maps Helix listing IDs to Shopify product IDs. Essential for:
- Finding the Shopify product when a Helix webhook arrives
- Preventing echo loops (see section 8)
- Reconciliation (see section 12)

```prisma
model ProductMapping {
  id               String   @id @default(cuid())
  shopId           String
  helixListingId   String   // Helix listing ID (e.g. "lst_xyz789")
  shopifyProductId String   // Shopify product GID
  lastSyncedAt     DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([shopId, helixListingId])
  @@index([shopifyProductId])
  @@index([shopId])
}
```

### Modified Model: `MarketplaceListing`

Add optional field to track source:

```prisma
model MarketplaceListing {
  // ... existing fields ...

  // NEW: where this listing originated from
  sourceMarketplace String?  // "helix" | null (null = legacy/shopify-originated)
}
```

### `MarketplaceAccount.settings` Schema (JSON)

For the Helix marketplace account, the `settings` JSON should include:

```typescript
{
  webhookSecret: string;       // HMAC secret for verifying Helix webhooks
  helixSellerId: string;       // Helix seller account ID
  syncRules: SyncRules;        // Same sync rules structure as eBay
  autoSyncNew: boolean;        // Auto-create Shopify products from new Helix listings
  locationId?: string;         // Cached Shopify location ID for inventory mutations
}
```

### Migration

```sql
-- New table
CREATE TABLE "ProductMapping" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "helixListingId" TEXT NOT NULL,
  "shopifyProductId" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "ProductMapping_shopId_helixListingId_key" ON "ProductMapping"("shopId", "helixListingId");
CREATE INDEX "ProductMapping_shopifyProductId_idx" ON "ProductMapping"("shopifyProductId");
CREATE INDEX "ProductMapping_shopId_idx" ON "ProductMapping"("shopId");

-- Add column to existing table
ALTER TABLE "MarketplaceListing" ADD COLUMN "sourceMarketplace" TEXT;
```

---

## 10. Existing Webhook Handler Changes

### `webhooks.products.create.tsx`

**Current:** On new Shopify product → auto-sync to eBay.

**Change:** Add echo loop check at the top:

```typescript
// Skip if this product was created by the Helix sync engine
const productGid = `gid://shopify/Product/${payload.id}`;
const mapping = await db.productMapping.findFirst({
  where: { shopId: shop, shopifyProductId: productGid },
});
if (mapping) {
  console.log(`Product ${payload.id} originated from Helix — skipping outbound sync`);
  return new Response();
}
```

**Remaining logic stays the same** — if a product is created manually in Shopify (not from Helix), it still syncs to eBay as before.

### `webhooks.products.update.tsx`

**Current:** On Shopify product update → update eBay listing.

**Change:** Same echo loop check. If the update was triggered by the sync engine writing Helix data to Shopify, skip.

### `webhooks.orders.create.tsx`

**Current:** On Shopify order → `delistFromAllExcept(shop, productGid, "shopify")`.

**Change:** Also notify Helix when a product sells on Shopify:

```typescript
// After existing delistFromAllExcept call:
const helixAccount = await db.marketplaceAccount.findUnique({
  where: { shopId_marketplace: { shopId: shop, marketplace: "helix" } },
});

if (helixAccount) {
  const mapping = await db.productMapping.findFirst({
    where: { shopId: shop, shopifyProductId: productGid },
  });
  if (mapping) {
    // Update Helix inventory to 0
    await helixAdapter.updateInventory(mapping.helixListingId, 0, helixAccount);
  }
}
```

### `webhooks.inventory.update.tsx`

**Current:** Inventory drops to 0 → delist from all marketplaces. Inventory restored → relist.

**Change:** Also update Helix inventory when Shopify inventory changes:

```typescript
// After existing delist/relist logic:
if (helixAccount && mapping) {
  await helixAdapter.updateInventory(mapping.helixListingId, available, helixAccount);
}
```

**Important:** Need echo loop prevention here too — if inventory changed because the app SET it (from Helix webhook), don't notify Helix back.

---

## 11. Dashboard & UI Updates

### `app/routes/app.helix.tsx`

Replace the current placeholder page with a full management interface:

**Connection Section:**
- OAuth connect/disconnect button (functional, not disabled)
- Connection status with last sync time
- Helix seller ID display

**Sync Section (new):**
- "Pull from Helix" button — triggers `syncHelixToAllMarketplaces()` for all active Helix listings
- "Pull New Only" — only listings not yet in `ProductMapping`
- Progress indicator during bulk sync
- Last sync timestamp

**Listing Status Table (new):**
- All Helix listings with their sync status
- Columns: Helix ID, Title, Price, Shopify Status, eBay Status
- Error display for failed syncs

**Remove:**
- CSV Export section (no longer needed — app pulls via API)
- "Integration Roadmap" section (it's live now)
- "Inventory Readiness" section (replaced by listing status table)

### `app/routes/app._index.tsx` (Dashboard)

**Marketplace health tiles:** Helix tile should show as "Source" rather than just another destination:
- Active listings (from Helix)
- Last sync time
- Sync errors

**Sync activity:** Show inbound syncs (Helix → Shopify) alongside outbound (Shopify → eBay):
- "Pulled from Helix" as a new action type
- "Created on Shopify" as a new action type

---

## 12. Reconciliation Cron Updates

### File: `app/routes/api.reconcile.tsx`

**Current:** Checks Shopify inventory → delist/relist on eBay/Whatnot.

**Option B change:** The source of truth is now Helix, so reconciliation should:

1. Fetch all active Helix listings (via `helixAdapter.fetchListings()`)
2. Compare against `ProductMapping` records
3. For listings missing from Shopify: create via `syncHelixToShopify()`
4. For Shopify products not in Helix: optionally archive/delist
5. For inventory mismatches: Helix value wins — update Shopify and eBay

```typescript
// Reconciliation flow for Option B:
for (const helixListing of await helixAdapter.fetchListings(account)) {
  const mapping = await db.productMapping.findUnique({
    where: { shopId_helixListingId: { shopId, helixListingId: helixListing.id } },
  });

  if (!mapping) {
    // Missing from Shopify — create
    await syncHelixToAllMarketplaces(shopId, admin, helixListing);
  } else {
    // Exists — check inventory match
    const shopifyInventory = await getShopifyInventory(admin, mapping.shopifyProductId);
    if (shopifyInventory !== helixListing.quantity) {
      // Helix wins — update Shopify
      await setInventoryQuantity(admin, inventoryItemId, locationId, helixListing.quantity);
    }
  }
}
```

---

## 13. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `app/lib/helix-client.server.ts` | HTTP client + OAuth token management for Helix API |
| `app/lib/adapters/helix.server.ts` | Read/write adapter for Helix marketplace |
| `app/lib/shopify-writer.server.ts` | Shopify product create/update/metafield/inventory mutations |
| `app/lib/mappers/helix-to-shopify-mapper.ts` | Transform Helix listing → Shopify product + metafields |
| `app/routes/api.helix-callback.tsx` | OAuth callback handler for Helix |
| `app/routes/api.helix-webhooks.tsx` | Inbound webhook handler for Helix events |
| `prisma/migrations/xxx_add_product_mapping/migration.sql` | New `ProductMapping` table + `sourceMarketplace` column |

### Modified Files

| File | Change |
|------|--------|
| `app/lib/sync-engine.server.ts` | Add `syncHelixToShopify()`, `syncHelixToAllMarketplaces()`. Update `delistFromAllExcept()` to handle Shopify as target. |
| `app/routes/webhooks.products.create.tsx` | Add echo loop check (skip Helix-originated products) |
| `app/routes/webhooks.products.update.tsx` | Add echo loop check |
| `app/routes/webhooks.orders.create.tsx` | Notify Helix of Shopify sales |
| `app/routes/webhooks.inventory.update.tsx` | Sync inventory changes to Helix + echo loop prevention |
| `app/routes/app.helix.tsx` | Full rewrite — OAuth flow, pull sync, listing status |
| `app/routes/app._index.tsx` | Dashboard updates for Helix-as-source display |
| `app/routes/api.reconcile.tsx` | Helix-first reconciliation logic |
| `prisma/schema.prisma` | Add `ProductMapping` model, `sourceMarketplace` field |
| `shopify.app.toml` | Add Helix webhook endpoint if needed |

### Files Unchanged

| File | Why |
|------|-----|
| `app/lib/adapters/ebay.server.ts` | eBay adapter stays the same — still pushes listings |
| `app/lib/mappers/ebay-mapper.ts` | eBay mapping unchanged — receives same `CardMetafields` input |
| `app/lib/mappers/whatnot-mapper.ts` | Whatnot CSV mapping unchanged |
| `app/lib/sync-rules.server.ts` | Sync rules engine unchanged — same interface |
| `app/lib/ebay-client.server.ts` | eBay OAuth/API client unchanged |
| `app/lib/shopify-helpers.server.ts` | Read helpers unchanged (still used for queries) |

---

## 14. Implementation Sequence

Build order, accounting for dependencies:

### Phase 1: Foundation (no Helix API needed)

These can be built and tested against mock data before the Helix API exists.

1. **Database migration** — Add `ProductMapping` model and `sourceMarketplace` field
2. **`shopify-writer.server.ts`** — All Shopify write mutations. Test by creating products from hardcoded data.
3. **`helix-to-shopify-mapper.ts`** — Reverse mapper. Unit-testable with mock Helix listing objects.
4. **Echo loop prevention** — Add checks to existing webhook handlers. Test by creating products with `helix-synced` tag.

### Phase 2: Helix Integration (requires Helix API access)

5. **`helix-client.server.ts`** — OAuth flow + authenticated API calls
6. **`api.helix-callback.tsx`** — OAuth callback route
7. **`adapters/helix.server.ts`** — Helix adapter (read + write)
8. **`api.helix-webhooks.tsx`** — Inbound webhook handler

### Phase 3: Sync Engine

9. **Sync engine refactor** — Add `syncHelixToShopify()` and `syncHelixToAllMarketplaces()`
10. **Update `delistFromAllExcept()`** — Shopify as delist target, Helix as exclude option
11. **Update existing webhook handlers** — `orders.create` notifies Helix, `inventory.update` syncs to Helix

### Phase 4: UI & Polish

12. **Rewrite `app.helix.tsx`** — Full management page with OAuth, pull sync, status table
13. **Update dashboard** — Helix-as-source display in marketplace health tiles
14. **Update reconciliation cron** — Helix-first reconciliation logic

### Phase 5: Remove Option A Artifacts

15. **Remove Helix CSV export** — Delete `api.export-helix.tsx` and `mappers/helix-mapper.ts` (replaced by API sync)
16. **Update Helix roadmap references** — Remove "coming soon" language from UI

---

<p align="center">
  <em>This document is the implementation spec for Option B. Phase 1 can begin immediately — Phases 2+ require Helix API access.</em>
</p>
