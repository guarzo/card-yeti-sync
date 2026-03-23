# Sync Settings, Bulk Ops, and Price Rules — Design Spec

**Date:** 2026-03-22

**Goal:** Wire up the disabled eBay sync settings toggles, add manual reconciliation trigger, add bulk initial sync with eBay listing import, and add per-marketplace discount percentages.

---

## 1. eBay Sync Settings Toggles

### Current State
The eBay settings page (`app/routes/app.ebay.tsx`) has three disabled `<s-switch>` elements in the "Sync Settings" section:
- Auto-sync new products
- Inventory sync
- Cross-channel delisting

The "Auto-sync new products" setting already exists on the Sync Rules page (`app/routes/app.sync-rules.tsx`) as `autoSyncNew` per marketplace.

### Design

**Remove** the "Auto-sync new products" toggle from the eBay page (it's a duplicate of the Sync Rules page setting).

**Wire up** the remaining two toggles:

| Toggle | Setting key | Default | What it controls |
|--------|------------|---------|-----------------|
| Inventory sync | `settings.inventorySyncEnabled` | `true` | Whether `inventory_levels/update` webhook triggers delist/relist |
| Cross-channel delisting | `settings.crossChannelDelistEnabled` | `true` | Whether `orders/create` webhook triggers cross-channel delist |

**Storage:** Both stored in `MarketplaceAccount.settings` JSON alongside existing fields (`shadowMode`, `syncRules`, policy IDs).

**Implementation:**
- Loader reads current toggle values from account settings
- Each toggle wrapped in a `<Form method="post">` with `intent="toggle-inventory-sync"` / `intent="toggle-cross-channel-delist"`
- Action handler updates `account.settings` (same pattern as `toggle-shadow`)
- Webhook handlers check the setting before acting:
  - `webhooks.inventory.update.tsx`: early return if `inventorySyncEnabled === false`
  - `webhooks.orders.create.tsx`: early return if `crossChannelDelistEnabled === false`

**Files:**
- Modify: `app/routes/app.ebay.tsx` (remove auto-sync toggle, wire remaining two)
- Modify: `app/routes/webhooks.inventory.update.tsx` (check setting)
- Modify: `app/routes/webhooks.orders.create.tsx` (check setting)

---

## 2. Per-Marketplace Discount Percentage

### Current State
A 5% Shopify discount is hardcoded as `SHOPIFY_DISCOUNT = 0.05` in `app/routes/api.prices.tsx`. This is applied globally when uploading price CSVs: `newPrice = csvPrice * (1 - 0.05)`.

The mappers use `compareAtPrice` (the "market comp" price) as the listing price on external marketplaces. The Shopify `price` is set to `compareAtPrice * 0.95` so Shopify shows a discount.

### Design

**Add `discountPercent`** to each `MarketplaceAccount.settings`:
```
settings.discountPercent: number  // default: 5 (meaning 5%)
```

This controls the Shopify storefront discount relative to marketplace price. When a price CSV is uploaded, the discount applied to Shopify's `price` field uses this value instead of the hardcoded 5%.

**UI:** A number input on each marketplace's settings page (or in the Sync Rules page under each marketplace). Label: "Shopify discount %" with helper text: "Shopify storefront price will be this much lower than the marketplace listing price."

**Where it's applied:**
- `app/routes/api.prices.tsx` — replace `SHOPIFY_DISCOUNT` constant with per-marketplace value from the account that triggered the price update
- Note: The CSV upload is marketplace-agnostic (it updates Shopify prices), so we use a global default. The per-marketplace discount becomes relevant when we have marketplace-specific pricing in the future.

**Simpler approach for now:** Since the CSV upload applies one discount to all Shopify prices regardless of marketplace, make it a **shop-level setting** stored on the first connected marketplace account (or a separate app-level setting). The UI is a single input on the Sync Rules page under a "Pricing" section.

**Files:**
- Modify: `app/routes/api.prices.tsx` (read discount from DB instead of constant)
- Modify: `app/routes/app.sync-rules.tsx` (add pricing section with discount % input)
- Modify: `app/routes/app.ebay.tsx` (optional: show current discount on eBay page)

---

## 3. Bulk Initial Sync with eBay Listing Import

### Current State
No bulk sync exists. Products are synced individually via webhooks. There's no way to import existing eBay listings created by Marketplace Connector into Card Yeti's database.

### Design

**"Import Existing Listings" button** on the eBay settings page. This is a read-only operation that:

1. Fetches all active Shopify products via `getAllProducts(admin, { query: "status:active" })`
2. For each product, queries eBay Sell Inventory API:
   - `GET /sell/inventory/v1/inventory_item/{sku}` — check if inventory item exists
   - `GET /sell/inventory/v1/offer?sku={sku}` — get offer ID and listing ID
3. If found: creates a `MarketplaceListing` record with the real eBay `marketplaceId` (listing ID) and `offerId`
4. If not found: adds to mismatch report
5. Skips products that already have a `MarketplaceListing` record for eBay

**Results shown to user:**
- Imported: X listings
- Already tracked: X listings (skipped)
- Not found on eBay: X products (with list of SKUs/titles for investigation)

**Implementation approach:**
- New action handler `intent="import-listings"` on the eBay page
- Runs synchronously for simplicity (most shops have < 1000 products)
- For shops with many products, eBay rate limits apply (5000 calls/day for Sell Inventory API). Each product requires 2 API calls (inventory item GET + offers GET), so this safely handles up to ~2500 products per run.
- Returns results as JSON, displayed in a results banner
- Respects shadow mode (these are all read operations, safe to run)

**Rate limiting:** Add a 100ms delay between eBay API calls to stay well within limits. For 500 products, this takes ~100 seconds.

**Files:**
- Modify: `app/routes/app.ebay.tsx` (add action handler + UI button + results display)
- Modify: `app/lib/adapters/ebay.server.ts` (add `getInventoryItem()` and `getOffersForSku()` read functions)

---

## 4. Manual Reconciliation Trigger

### Current State
Reconciliation runs via QStash cron (`app/routes/api.reconcile.tsx`) with Bearer token auth. No UI trigger exists.

### Design

**"Reconcile Now" button** on the eBay settings page (in the Sync Settings section).

**Implementation:**
- Extract the reconciliation logic from `api.reconcile.tsx` into a shared function in `app/lib/sync-engine.server.ts`:
  ```
  reconcileShop(shopId: string, admin: AdminApiContext): Promise<ReconcileResult>
  ```
- The QStash endpoint calls this function after auth (uses `unauthenticated.admin()` for admin context)
- The eBay page adds a new action `intent="reconcile"` that calls the same function (uses `authenticate.admin()` for admin context)
- Results shown in a banner: "Reconciled: X delisted, X relisted, X errors"

**Why on the eBay page (not dashboard):**
- Reconciliation currently only affects eBay listings (Whatnot/Helix are CSV-only with no API)
- When more marketplaces get API support, this can move to a global settings page

**Files:**
- Modify: `app/lib/sync-engine.server.ts` (extract `reconcileShop()` function)
- Modify: `app/routes/api.reconcile.tsx` (call extracted function)
- Modify: `app/routes/app.ebay.tsx` (add action handler + UI button)

---

## Settings Storage Summary

All new settings stored in `MarketplaceAccount.settings` JSON:

```typescript
interface AccountSettings {
  // Existing
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  shadowMode?: boolean;
  syncRules?: SyncRules;

  // New
  inventorySyncEnabled?: boolean;    // default: true
  crossChannelDelistEnabled?: boolean; // default: true
  discountPercent?: number;          // default: 5
}
```

No Prisma schema changes needed — everything fits in the existing JSON field.

---

## UI Layout on eBay Page

The Sync Settings section becomes:

```
Sync Settings
├── Shadow mode toggle          (existing)
├── Inventory sync toggle       (new — enables/disables inventory webhook)
├── Cross-channel delisting toggle (new — enables/disables order webhook delist)
├── Reconcile Now button        (new — manual reconciliation trigger)
└── Import Existing Listings button (new — one-time eBay listing import)
```

The pricing discount input goes on the Sync Rules page under a new "Pricing" section.
