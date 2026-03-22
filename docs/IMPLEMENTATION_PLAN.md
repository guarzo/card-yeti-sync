# Implementation Plan

Detailed breakdown of remaining work for Card Yeti Sync. Phase 1 (scaffold, Prisma schema, Helix proposal, dashboard, webhook stubs) is complete.

---

## What Exists Today

```
app/routes/
  app._index.tsx          Dashboard — product overview + per-marketplace sync count cards
  app.ebay.tsx            eBay settings — placeholder UI (connect button, policy cards)
  app.whatnot.tsx          Whatnot settings — placeholder UI (CSV export, API notice)
  app.helix.tsx            Helix settings — placeholder UI (connect button, feature list)
  app.tsx                  App shell — nav links to Dashboard, eBay, Whatnot, Helix
  webhooks.*.tsx           Stub handlers — log topic + payload, TODO comments for each

prisma/schema.prisma       Session, MarketplaceAccount, MarketplaceListing, SyncLog
shopify.app.toml           Scopes + webhook subscriptions declared
docs/HELIX_PROPOSAL.md    Integration proposal (ready to send)
docs/PRD.md                Product requirements document
```

**Not yet built:** `app/lib/` (adapters, mappers, clients, sync engine), functional webhook handlers, eBay OAuth flow, CSV export, admin block extension, reconciliation endpoint.

---

## Phase 2: eBay Direct Integration

### 2.1 eBay OAuth Client

**File:** `app/lib/ebay-client.server.ts`

Handles the full OAuth authorization code grant lifecycle for eBay Sell APIs. Ported from the pattern in `yeti-shop/scripts/helpers/ebay-client.js` (which only does client_credentials for Browse API).

**Functions to implement:**

```typescript
// Build the eBay consent URL for the OAuth redirect
getAuthorizationUrl(state: string): string
// Scopes: sell.inventory, sell.account, sell.fulfillment, sell.inventory.readonly

// Exchange authorization code for access + refresh tokens
exchangeCodeForTokens(code: string): Promise<{ accessToken, refreshToken, expiresIn }>

// Refresh an expired access token using the stored refresh token
refreshAccessToken(refreshToken: string): Promise<{ accessToken, expiresIn }>

// Make an authenticated API call to any eBay Sell API
// Handles reactive refresh: on 401, refresh token and retry once
ebayApiCall(method, url, body, account: MarketplaceAccount): Promise<Response>
```

**Env vars needed:**
- `EBAY_CLIENT_ID` — from eBay developer portal
- `EBAY_CLIENT_SECRET` — from eBay developer portal
- `EBAY_RU_NAME` — redirect URL name configured in eBay portal
- `EBAY_REDIRECT_URI` — the callback URL (e.g., `https://<app-url>/api/ebay-callback`)

**Token storage:** Access token and refresh token stored in `MarketplaceAccount.accessToken` / `.refreshToken`. Token expiry stored in `.tokenExpiry`. Access token expires in 2 hours; refresh token lasts 18 months.

**Key details:**
- eBay auth endpoint: `https://auth.ebay.com/oauth2/authorize`
- eBay token endpoint: `https://api.ebay.com/identity/v1/oauth2/token`
- Auth header for token exchange: `Basic base64(clientId:clientSecret)`
- Use reactive refresh (retry on 401) rather than preemptive timer

### 2.2 eBay OAuth Routes

**File:** `app/routes/api.ebay-callback.tsx`

Callback route for eBay OAuth. Receives the authorization code after seller consent.

```
Flow:
1. User clicks "Connect eBay" on app.ebay.tsx
2. App redirects to eBay consent URL (from getAuthorizationUrl)
3. Seller authorizes on eBay
4. eBay redirects to /api/ebay-callback?code=XXX&state=YYY
5. Route exchanges code for tokens via exchangeCodeForTokens()
6. Stores tokens in MarketplaceAccount (shopId + marketplace="ebay")
7. Redirects back to /app/ebay with success banner
```

**Update:** `app/routes/app.ebay.tsx`

Replace the disabled "Connect eBay Account" button with a working link that initiates the OAuth flow. After connection, show the connected account status and a "Disconnect" option.

### 2.3 eBay Business Policy Management

**File:** `app/lib/ebay-policies.server.ts`

Manages eBay business policies (fulfillment, payment, return) via the Account API v1.

**Functions:**

```typescript
// Fetch existing policies from eBay
getExistingPolicies(account): Promise<{
  fulfillment: Policy[],
  payment: Policy[],
  return: Policy[]
}>

// Create a fulfillment policy
// USPS Ground Advantage + First Class + Priority, 1 day handling, free shipping >$75
createFulfillmentPolicy(account, config): Promise<{ policyId }>

// Create a payment policy
// Immediate payment required, eBay managed payments
createPaymentPolicy(account, config): Promise<{ policyId }>

// Create a return policy
// 30-day returns, buyer pays return shipping
createReturnPolicy(account, config): Promise<{ policyId }>
```

**API endpoints:**
- `GET /sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US`
- `POST /sell/account/v1/fulfillment_policy`
- `POST /sell/account/v1/payment_policy`
- `POST /sell/account/v1/return_policy`

**Policy IDs** are stored in `MarketplaceAccount.settings` as JSON:
```json
{
  "fulfillmentPolicyId": "...",
  "paymentPolicyId": "...",
  "returnPolicyId": "..."
}
```

**Update:** `app/routes/app.ebay.tsx`

Replace static policy cards with:
- Dropdown to select existing policies OR button to create new ones
- Show selected policy names and IDs
- Save to MarketplaceAccount.settings

### 2.4 eBay Data Mapper

**File:** `app/lib/mappers/ebay-mapper.ts`

Transforms a Shopify product + card metafields into the eBay Inventory API format. Port logic from `yeti-shop/scripts/helpers/product-builder.js` and `scripts/import-from-ebay.js`.

**Functions:**

```typescript
// Extract card metafields from Shopify product into a flat object
extractCardMetafields(metafieldEdges): CardMetafields

// Map Shopify product to eBay inventory item format
mapToInventoryItem(product, metafields: CardMetafields): EbayInventoryItem

// Map Shopify product to eBay offer format (includes policy IDs)
mapToOffer(product, metafields: CardMetafields, settings: EbaySettings): EbayOffer
```

**Item specifics mapping** (from card metafields to eBay name-value pairs):

| Metafield Key | eBay Item Specific Name |
|---|---|
| `pokemon` | `Pokémon Character` |
| `set_name` | `Set` |
| `number` | `Card Number` |
| `grading_company` | `Professional Grader` |
| `grade` | `Grade` |
| `cert_number` | `Certification Number` |
| `language` | `Language` |
| `year` | `Year Manufactured` |
| `rarity` | `Rarity` |
| `condition` | `Card Condition` |

**Price mapping:**
- eBay listing price = Shopify `compareAtPrice` (the market comp, before the 5% Shopify discount)
- If no compareAtPrice, use `variant.price / 0.95` to reverse the discount

**eBay Inventory Item shape:**
```json
{
  "availability": { "shipToLocationAvailability": { "quantity": 1 } },
  "condition": "USED_EXCELLENT",
  "conditionDescription": "...",
  "product": {
    "title": "...",
    "description": "...",
    "imageUrls": ["..."],
    "aspects": {
      "Pokémon Character": ["Charizard"],
      "Set": ["Base Set"],
      "Card Number": ["4/102"],
      "Professional Grader": ["PSA"],
      "Grade": ["9"]
    }
  }
}
```

**eBay Offer shape:**
```json
{
  "sku": "PSA-12345678",
  "marketplaceId": "EBAY_US",
  "format": "FIXED_PRICE",
  "availableQuantity": 1,
  "categoryId": "183454",
  "listingPolicies": {
    "fulfillmentPolicyId": "...",
    "paymentPolicyId": "...",
    "returnPolicyId": "..."
  },
  "pricingSummary": {
    "price": { "value": "899.00", "currency": "USD" }
  }
}
```

### 2.5 eBay Adapter

**File:** `app/lib/adapters/ebay.server.ts`

Implements the marketplace adapter interface using the eBay Inventory API.

**Functions:**

```typescript
// Create or update an inventory item, create an offer, and publish it
async listProduct(product, metafields, account): Promise<{
  marketplaceId: string,  // eBay listing ID
  offerId: string,        // eBay offer ID (needed for updates/delist)
  url: string,            // eBay listing URL
  status: "active" | "error"
}>

// Update an existing listing (revise inventory item + offer)
async updateProduct(listing: MarketplaceListing, product, metafields, account): Promise<{ status }>

// End a listing (withdraw offer)
async delistProduct(listing: MarketplaceListing, account): Promise<{ status }>

// Update just the quantity (0 to hide, 1 to show)
async updateInventory(listing: MarketplaceListing, quantity, account): Promise<{ status }>

// Update just the price
async updatePrice(listing: MarketplaceListing, price, account): Promise<{ status }>
```

**Inventory API call sequence for listing:**
1. `PUT /sell/inventory/v1/inventory_item/{sku}` — create/update inventory item
2. `POST /sell/inventory/v1/offer` — create offer with policy IDs
3. `POST /sell/inventory/v1/offer/{offerId}/publish` — publish to eBay
4. Store listing ID + offer ID in `MarketplaceListing`

**Bulk operations for initial sync:**
- `POST /sell/inventory/v1/bulk_create_or_replace_inventory_item` (25 items/call)
- `POST /sell/inventory/v1/bulk_create_offer` (25 items/call)
- `POST /sell/inventory/v1/bulk_publish_offer` (25 items/call)

**Delist:** `POST /sell/inventory/v1/offer/{offerId}/withdraw`

**Update price:** `POST /sell/inventory/v1/bulk_update_price_quantity` (up to 25)

**Error handling:**
- 401 → refresh token and retry (handled by ebay-client.server.ts)
- 409 (conflict) → item already exists, switch to update flow
- 404 on delist → already removed, mark as delisted
- Log all errors to SyncLog

### 2.6 Wire Up the eBay Settings Page

**Update:** `app/routes/app.ebay.tsx`

Full functional rewrite:

1. **Connection section:**
   - If not connected: "Connect eBay Account" button → initiates OAuth
   - If connected: show account status, last token refresh, "Disconnect" button

2. **Business Policies section:**
   - Load existing eBay policies via Account API
   - Dropdowns to select fulfillment, payment, return policy
   - Or "Create Default Policies" button that creates Card Yeti's standard policies
   - Save selected policy IDs to MarketplaceAccount.settings

3. **Sync section:**
   - "Sync All Products" button → bulk sync via adapter
   - "Sync New Only" button → sync products not yet in MarketplaceListing
   - Product count: X synced / Y total
   - Last sync timestamp
   - Error list with retry buttons

4. **Sync Rules section (Phase 5, placeholder for now):**
   - Which product types to sync
   - Collection filters
   - Price markup rules

### 2.7 Wire Up Product Webhook Handlers

**Update:** `app/routes/webhooks.products.update.tsx` and `webhooks.products.create.tsx`

Replace the stub with:
1. Look up `MarketplaceAccount` for this shop where marketplace = "ebay"
2. If no eBay connection, return early
3. Extract product data from webhook payload
4. Fetch full product details via Admin API (webhook payload may be partial)
5. Fetch card metafields for the product
6. Check if a `MarketplaceListing` exists for this product + "ebay"
7. If exists → call `ebayAdapter.updateProduct()`
8. If not exists → call `ebayAdapter.listProduct()`
9. Update/create `MarketplaceListing` record
10. Log to `SyncLog`

### 2.8 Verification

- [ ] Connect eBay account via settings page — tokens stored in MarketplaceAccount
- [ ] Create default business policies — visible in eBay Seller Hub > Business Policies
- [ ] Sync 2-3 test products — listings appear on eBay with correct policies attached
- [ ] Item specifics populated (Pokemon Character, Set, Grade, etc.)
- [ ] Prices correct (compareAtPrice mapped to eBay listing price)
- [ ] Update a product title in Shopify → change reflected on eBay within seconds
- [ ] Dry-run / preview mode works before committing to live listings

---

## Phase 3: Cross-Channel Inventory + Dashboard

### 3.1 Sync Engine

**File:** `app/lib/sync-engine.server.ts`

Central orchestrator that coordinates across marketplace adapters.

**Functions:**

```typescript
// Delist a product from all marketplaces (except the one where it sold)
async delistFromAllExcept(shopId, productId, excludeMarketplace?): Promise<SyncResult[]>

// Relist a product on all marketplaces where it was previously delisted
async relistAll(shopId, productId): Promise<SyncResult[]>

// Full reconciliation: compare Shopify inventory with all marketplace listings
async reconcile(shopId): Promise<ReconciliationReport>

// Sync a single product to all enabled marketplaces
async syncProduct(shopId, product, metafields): Promise<SyncResult[]>
```

### 3.2 Order Webhook Handler

**Update:** `app/routes/webhooks.orders.create.tsx`

1. Parse order line items from payload
2. For each line item, get the Shopify product ID
3. Find all `MarketplaceListing` records for that product with status="active"
4. For each active listing on a marketplace OTHER than where it sold:
   - Call the appropriate adapter's `delistProduct()`
   - Update listing status to "delisted"
5. Log all actions to SyncLog

### 3.3 Inventory Webhook Handler

**Update:** `app/routes/webhooks.inventory.update.tsx`

1. Get `inventory_item_id` and `available` quantity from payload
2. Look up the Shopify product by inventory item ID (requires Admin API call)
3. If `available === 0`: call `syncEngine.delistFromAllExcept(shopId, productId)`
4. If `available > 0` and product has delisted listings: call `syncEngine.relistAll(shopId, productId)`
5. Log to SyncLog

### 3.4 eBay Inbound Notifications

**File:** `app/routes/api.ebay-notifications.tsx`

Receives eBay `ORDER_CONFIRMATION` webhook when a card sells on eBay.

1. Verify notification signature (ECDSA)
2. Extract listing ID from notification payload
3. Look up `MarketplaceListing` by eBay listing ID
4. Set Shopify inventory to 0 via Admin API (`inventoryAdjustQuantities` mutation)
5. This triggers the `inventory_levels/update` webhook → which triggers cross-channel delist

**eBay notification setup:**
- Create a destination: `POST /sell/notification/v1/destination` (the app's webhook URL)
- Validate via SHA-256 challenge-response
- Subscribe: `POST /sell/notification/v1/subscription` (topic: `MARKETPLACE_ACCOUNT_DELETION`, `ORDER_CONFIRMATION`)

### 3.5 Reconciliation Endpoint

**File:** `app/routes/api.reconcile.tsx`

Called by QStash cron (Upstash) every 15 minutes. Unauthenticated route secured by a shared secret header.

1. Verify `Authorization: Bearer <QSTASH_SECRET>` header
2. For each shop with active marketplace accounts:
   a. Fetch all active Shopify products with inventory
   b. Fetch all `MarketplaceListing` records with status="active"
   c. For each listing where Shopify inventory = 0 but listing is still active → delist
   d. For each product where Shopify inventory > 0 but no active listing → relist (if was previously synced)
3. Log all corrections to SyncLog
4. Return summary

**QStash setup:**
- Create a schedule in the Upstash dashboard
- URL: `https://<app-url>/api/reconcile`
- Schedule: every 15 minutes
- Header: `Authorization: Bearer <QSTASH_SECRET>`

### 3.6 Enhanced Dashboard

**Update:** `app/routes/app._index.tsx`

Add to the existing overview cards:

1. **Activity log section:** Recent SyncLog entries (last 50), showing action, marketplace, product, status, timestamp. Filterable by marketplace and status.

2. **Error section:** Products with status="error" across any marketplace. Each row shows: product title, marketplace, error message, "Retry" button.

3. **Quick actions:**
   - "Sync All" button → triggers `syncEngine.syncProduct()` for all unsynced products
   - "Reconcile Now" button → triggers `syncEngine.reconcile()` manually
   - "Export Activity Log" → download SyncLog as CSV

### 3.7 Product Admin Block Extension

**Directory:** `extensions/product-sync-status/`

Generate via: `shopify app generate extension --template admin_block --name product-sync-status`

Target: `admin.product-details.block.render`

Shows on each product's detail page in Shopify admin:

1. Per-marketplace status badges (Active / Not Listed / Error / Pending)
2. Marketplace listing URLs (clickable links to eBay listing, etc.)
3. Last sync timestamp per marketplace
4. "Sync Now" button → calls app API to sync this specific product
5. "Delist" button per marketplace → calls adapter to remove listing

**Implementation notes:**
- Extension uses Preact (64KB bundle limit)
- Reads product metafields + calls app API for MarketplaceListing data
- Must use `@shopify/ui-extensions-react/admin` components

### 3.8 Verification

- [ ] Create a test order in Shopify → product delisted from eBay within seconds
- [ ] Manually set inventory to 0 → cross-channel delist fires
- [ ] Set inventory back to 1 → relist fires on previously synced marketplaces
- [ ] eBay sale notification → Shopify inventory set to 0 → cross-channel delist
- [ ] Dashboard activity log shows all sync events
- [ ] Dashboard error section shows failed syncs with retry
- [ ] Reconciliation endpoint catches intentionally created drift
- [ ] Product admin block shows correct status on product page

---

## Phase 4: Whatnot + Helix Adapters

### 4.1 Shopify Product Fetcher

**File:** `app/lib/shopify-helpers.server.ts`

Shared helper for fetching products with metafields from the Shopify Admin API. Used by all adapters and the CSV export.

```typescript
// Fetch a single product with all card metafields
async getProductWithMetafields(admin, productId): Promise<{ product, metafields }>

// Fetch all products with pagination and optional filters
async getAllProducts(admin, filters?: { status?, productType?, collection? }): Promise<Product[]>

// Extract card metafields from the metafield edges array into a flat key-value map
extractCardMetafields(metafieldEdges): Record<string, string>
```

Port the pagination + metafield extraction logic from `yeti-shop/scripts/export-whatnot.js`.

### 4.2 Whatnot Mapper

**File:** `app/lib/mappers/whatnot-mapper.ts`

Port from `yeti-shop/scripts/helpers/whatnot-columns.js`.

```typescript
// CSV column headers (fixed order, matches Whatnot bulk upload template)
WHATNOT_HEADERS: string[]

// Shipping profiles by product type
SHIPPING_PROFILES: Record<string, string>

// Build a plaintext description from card metafields
buildWhatnotDescription(metafields, product): string

// Map a Shopify product to a Whatnot CSV row array
mapToWhatnotRow(product, metafields, variant, options?): string[]

// Generate a complete CSV string from an array of products
generateWhatnotCSV(products: ProductWithMetafields[]): string
```

**Improvements over yeti-shop version:**
- Support raw singles (condition from metafield, not hardcoded "Graded")
- Support sealed product (condition = "Brand New")
- Richer descriptions: include year, rarity, population, centering, subgrades
- Track which products have been exported via MarketplaceListing records

### 4.3 Whatnot Adapter

**File:** `app/lib/adapters/whatnot.server.ts`

CSV-based adapter. Implements the adapter interface but generates CSV output instead of making API calls.

```typescript
// Generate CSV for products that haven't been exported yet
async exportNew(shopId, admin, options?): Promise<{ csv: string, count: number }>

// Generate CSV for all active products
async exportAll(shopId, admin, options?): Promise<{ csv: string, count: number }>

// Mark products as exported in MarketplaceListing
async markExported(shopId, productIds): Promise<void>
```

**Options:** product type filter, price range, shipping profile override, collection filter.

### 4.4 Whatnot Settings Page

**Update:** `app/routes/app.whatnot.tsx`

Replace placeholder with functional page:

1. **Export controls:**
   - "Export All Products" button → downloads CSV
   - "Export New Only" button → downloads CSV for un-exported products only
   - Product type checkboxes (Graded Card, Raw Single, Sealed Product)
   - Price range filters (min/max)

2. **Export history:**
   - Table of past exports: date, product count, download link (if cached)

3. **Stats:**
   - Total exportable products
   - Previously exported count
   - New since last export

### 4.5 Helix Adapter

**File:** `app/lib/adapters/helix.server.ts`

Stub adapter that will be implemented when Helix's API is available. For now, log-only.

```typescript
// Placeholder — returns "pending" status until API is available
async listProduct(...): Promise<{ status: "pending", message: "Helix API not yet available" }>

// Same for all other interface methods
```

### 4.6 Helix Mapper

**File:** `app/lib/mappers/helix-mapper.ts`

Maps Shopify product to the schema proposed in `docs/HELIX_PROPOSAL.md`.

```typescript
// Map Shopify product to Helix listing format
mapToHelixListing(product, metafields: CardMetafields): HelixListing

// The HelixListing type matches the proposed schema:
// { title, description, price_cents, listing_type, condition, images, card: { ... }, external_refs: { ... } }
```

This mapper can be built and tested now even without the API — it validates that our metafield data maps cleanly to the proposed schema.

### 4.7 Helix Settings Page

**Update:** `app/routes/app.helix.tsx`

Enhance with:
1. Connection status (placeholder until API exists)
2. Preview of how products would appear in Helix's format (uses helix-mapper to show a sample product's mapped data)
3. Link to the proposal document

### 4.8 Verification

- [ ] Whatnot CSV export downloads from app UI
- [ ] CSV includes graded cards, raw singles, and sealed product
- [ ] "Export New Only" correctly skips previously exported products
- [ ] Export history visible in the UI
- [ ] Helix mapper correctly transforms sample products (unit test)
- [ ] Helix adapter gracefully returns pending status

---

## Phase 5: Migration + Polish

### 5.1 Marketplace Connect Migration

**File:** `app/routes/app.ebay.tsx` (migration section)

Add a migration workflow to the eBay settings page:

1. **Audit:** Fetch all existing eBay listings (via `GET /sell/inventory/v1/inventory_item?limit=100` with pagination). Show a table of listings not yet tracked in MarketplaceListing.

2. **Import:** For each existing eBay listing, create a MarketplaceListing record with the existing listing ID + offer ID. This puts them under the app's management without recreating them.

3. **Re-sync:** For listings that need policy updates, use `PUT /sell/inventory/v1/offer/{offerId}` to attach the correct business policies.

4. **Verify:** Show a side-by-side comparison: Marketplace Connect listings vs app-managed listings.

5. **Disable:** Once all listings are migrated, provide instructions to disable Marketplace Connect's auto-list feature.

### 5.2 Sync Rules UI

**File:** `app/routes/app.sync-rules.tsx` (new route)

Add to nav as a sub-page under each marketplace, or as a shared settings page.

**Rules per marketplace:**
- **Product type filter:** Which types to sync (Graded Card, Raw Single, Curated Lot, Sealed Product)
- **Collection filter:** Only sync products in specific collections
- **Tag filter:** Include/exclude by tag
- **Price range:** Min/max price for sync
- **Auto-sync new products:** Toggle — when a product is created, auto-sync to this marketplace

Store in `MarketplaceAccount.settings` JSON:
```json
{
  "syncRules": {
    "productTypes": ["Graded Card", "Raw Single"],
    "collections": ["graded-cards", "japanese-cards"],
    "excludeTags": ["do-not-sync"],
    "priceMin": null,
    "priceMax": null,
    "autoSyncNew": true
  }
}
```

### 5.3 Price Rules

**File:** `app/routes/app.price-rules.tsx` (new route) or section within each marketplace page

Configure per-marketplace pricing:
- **eBay:** Use `compareAtPrice` (market comp, default) or `variant.price` + markup %
- **Whatnot:** Ceil to nearest dollar (default) or custom markup
- **Helix:** Use `variant.price` (default) or custom

Store in `MarketplaceAccount.settings`:
```json
{
  "priceRules": {
    "source": "compareAtPrice",
    "markupPercent": 0,
    "roundUp": false
  }
}
```

### 5.4 App Store Preparation

Before submitting to the Shopify App Store:

- [ ] Privacy policy page (required)
- [ ] GDPR compliance handlers (already built: data_request, redact, shop/redact)
- [ ] App listing copy: name, tagline, description, screenshots
- [ ] Error handling: graceful failures, user-facing error messages
- [ ] Rate limiting: respect Shopify and eBay API limits
- [ ] Onboarding flow: first-time setup wizard
- [ ] Help/documentation page within the app

### 5.5 Verification

- [ ] Existing Marketplace Connect listings imported into app's management
- [ ] Policies updated on imported listings
- [ ] Sync rules filter products correctly per marketplace
- [ ] Price rules apply correct pricing per marketplace
- [ ] Marketplace Connect disabled with no regressions

---

## File Creation Summary

### Phase 2 — New files
```
app/lib/ebay-client.server.ts          eBay OAuth + API transport
app/lib/ebay-policies.server.ts        Business policy CRUD via Account API
app/lib/mappers/ebay-mapper.ts         Shopify → eBay data transform
app/lib/adapters/ebay.server.ts        eBay Inventory API adapter
app/routes/api.ebay-callback.tsx       eBay OAuth callback route
```

### Phase 2 — Updated files
```
app/routes/app.ebay.tsx                Functional OAuth + policies + sync UI
app/routes/webhooks.products.update.tsx  Wire to eBay adapter
app/routes/webhooks.products.create.tsx  Wire to eBay adapter
.env.example (create)                   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, etc.
```

### Phase 3 — New files
```
app/lib/sync-engine.server.ts          Cross-channel orchestrator
app/routes/api.ebay-notifications.tsx  eBay order webhook receiver
app/routes/api.reconcile.tsx           QStash cron endpoint
extensions/product-sync-status/        Admin block extension (generated)
```

### Phase 3 — Updated files
```
app/routes/webhooks.orders.create.tsx    Wire to sync engine
app/routes/webhooks.inventory.update.tsx  Wire to sync engine
app/routes/app._index.tsx                Activity log, errors, quick actions
```

### Phase 4 — New files
```
app/lib/shopify-helpers.server.ts      Product fetcher + metafield extraction
app/lib/mappers/whatnot-mapper.ts      Shopify → Whatnot CSV transform
app/lib/mappers/helix-mapper.ts        Shopify → Helix listing transform
app/lib/adapters/whatnot.server.ts     Whatnot CSV export adapter
app/lib/adapters/helix.server.ts       Helix stub adapter
```

### Phase 4 — Updated files
```
app/routes/app.whatnot.tsx             Functional CSV export UI
app/routes/app.helix.tsx               Enhanced preview + status
```

### Phase 5 — New files
```
app/routes/app.sync-rules.tsx          Sync rules configuration UI
app/routes/app.price-rules.tsx         Per-marketplace pricing rules UI
```

### Phase 5 — Updated files
```
app/routes/app.ebay.tsx                Migration workflow section
app/routes/app.tsx                     Nav updates for new pages
```

---

## Dependencies & Blockers

| Work Item | Depends On | Blocked By External? |
|-----------|-----------|---------------------|
| eBay OAuth client | eBay developer app with Sell API scopes | Need to verify app scopes in eBay portal |
| eBay business policies | eBay OAuth working | No |
| eBay adapter | OAuth + policies | No |
| eBay notifications | eBay OAuth + working adapter | No |
| Webhook handlers | eBay adapter | No |
| Reconciliation | Sync engine + at least one adapter | No |
| Whatnot CSV | Shopify product fetcher | No |
| Whatnot API | Whatnot Seller API access | Yes — Developer Preview closed |
| Helix API adapter | Helix building their API | Yes — waiting on proposal response |
| Helix mapper | Nothing (can build against proposed schema) | No |
| Admin block extension | At least one working adapter | No |
| Migration | eBay adapter fully working | No |
| App Store submission | All core features working | No |
