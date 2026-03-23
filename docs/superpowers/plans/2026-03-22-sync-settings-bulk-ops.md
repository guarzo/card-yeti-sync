# Sync Settings, Bulk Ops & Price Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up eBay sync toggles (inventory sync, cross-channel delist), add manual reconciliation trigger, bulk eBay listing import, and configurable Shopify discount percentage.

**Architecture:** All new settings stored in `MarketplaceAccount.settings` JSON (no schema changes). Sync toggles gate webhook handlers with early returns. Reconciliation logic extracted to a shared function callable from both QStash cron and eBay settings page. Bulk import reads eBay Sell Inventory API to discover existing listings by SKU. Discount % replaces the hardcoded constant in price uploads.

**Tech Stack:** TypeScript, React Router v7, Prisma, eBay Sell Inventory API, Vitest

---

## File Structure

### New Files
- `app/lib/account-settings.server.ts` — Helper to read typed settings from MarketplaceAccount with defaults

### Modified Files
- `app/routes/app.ebay.tsx` — Remove auto-sync toggle, wire inventory/delist toggles, add reconcile + import buttons
- `app/routes/webhooks.inventory.update.tsx` — Check `inventorySyncEnabled` before acting
- `app/routes/webhooks.orders.create.tsx` — Check `crossChannelDelistEnabled` before acting
- `app/lib/sync-engine.server.ts` — Extract `reconcileShop()` from api.reconcile.tsx
- `app/routes/api.reconcile.tsx` — Call extracted `reconcileShop()`
- `app/lib/adapters/ebay.server.ts` — Add `getInventoryItem()` and `getOffersForSku()` read functions
- `app/routes/api.prices.tsx` — Replace hardcoded discount with DB setting
- `app/routes/app.sync-rules.tsx` — Add discount % input

---

## Task 1: Create account settings helper

**Files:**
- Create: `app/lib/account-settings.server.ts`

This helper provides typed access to `MarketplaceAccount.settings` with defaults, avoiding repetitive casting throughout the codebase.

- [ ] **Step 1: Create the helper**

```typescript
// app/lib/account-settings.server.ts
import type { MarketplaceAccount } from "@prisma/client";

interface AccountSettings {
  shadowMode: boolean;
  inventorySyncEnabled: boolean;
  crossChannelDelistEnabled: boolean;
  discountPercent: number;
}

const DEFAULTS: AccountSettings = {
  shadowMode: false,
  inventorySyncEnabled: true,
  crossChannelDelistEnabled: true,
  discountPercent: 5,
};

export function getAccountSettings(
  account: Pick<MarketplaceAccount, "settings">,
): AccountSettings {
  const raw = (account.settings ?? {}) as Record<string, unknown>;
  return {
    shadowMode: raw.shadowMode === true,
    inventorySyncEnabled: raw.inventorySyncEnabled !== false, // default true
    crossChannelDelistEnabled: raw.crossChannelDelistEnabled !== false, // default true
    discountPercent:
      typeof raw.discountPercent === "number" && Number.isFinite(raw.discountPercent)
        ? raw.discountPercent
        : DEFAULTS.discountPercent,
  };
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All existing tests pass (no new tests needed — pure data access helper)

- [ ] **Step 3: Commit**

```bash
git add app/lib/account-settings.server.ts
git commit -m "feat: add typed account settings helper with defaults"
```

---

## Task 2: Wire inventory sync and cross-channel delist toggles

**Files:**
- Modify: `app/routes/app.ebay.tsx` — Remove auto-sync toggle, load settings, add toggle actions + UI
- Modify: `app/routes/webhooks.inventory.update.tsx` — Check setting
- Modify: `app/routes/webhooks.orders.create.tsx` — Check setting

- [ ] **Step 1: Update eBay page loader to read toggle settings**

In `app/routes/app.ebay.tsx` loader, the code already reads `accountSettings` for shadow mode (line 125). Extend to also read the new toggles:

```typescript
import { getAccountSettings } from "../lib/account-settings.server";

// In loader, replace the manual shadowMode read with:
const accountSettings = account ? getAccountSettings(account) : null;
const shadowMode = accountSettings?.shadowMode ?? false;
const inventorySyncEnabled = accountSettings?.inventorySyncEnabled ?? true;
const crossChannelDelistEnabled = accountSettings?.crossChannelDelistEnabled ?? true;
```

Add `inventorySyncEnabled` and `crossChannelDelistEnabled` to the return object and `LoaderData` interface.

- [ ] **Step 2: Add toggle action handlers**

In the action function, add two new intent handlers (same pattern as `toggle-shadow`):

```typescript
  if (intent === "toggle-inventory-sync") {
    const account = await db.marketplaceAccount.findFirst({
      where: { shopId: session.shop, marketplace: "ebay" },
    });
    if (!account) return Response.json({ error: "Not connected" }, { status: 400 });

    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    const newValue = !(currentSettings.inventorySyncEnabled !== false);
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: { settings: { ...currentSettings, inventorySyncEnabled: newValue } },
    });
    return Response.json({ success: true });
  }

  if (intent === "toggle-cross-channel-delist") {
    const account = await db.marketplaceAccount.findFirst({
      where: { shopId: session.shop, marketplace: "ebay" },
    });
    if (!account) return Response.json({ error: "Not connected" }, { status: 400 });

    const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
    const newValue = !(currentSettings.crossChannelDelistEnabled !== false);
    await db.marketplaceAccount.update({
      where: { id: account.id },
      data: { settings: { ...currentSettings, crossChannelDelistEnabled: newValue } },
    });
    return Response.json({ success: true });
  }
```

- [ ] **Step 3: Update Sync Settings UI**

In the component, remove the "Auto-sync new products" toggle block (the `<s-stack>` with `<s-switch label="Auto-sync new products" disabled />`). Replace the "Inventory sync" and "Cross-channel delisting" disabled switches with functional `<Form>` toggles:

```tsx
{connected && (
  <>
    <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
      <s-stack direction="block" gap="small">
        <s-text type="strong">Inventory sync</s-text>
        <s-text color="subdued">
          Delist from eBay when inventory reaches zero. Relist when inventory is restored.
        </s-text>
      </s-stack>
      <Form method="post">
        <input type="hidden" name="intent" value="toggle-inventory-sync" />
        <s-button variant={inventorySyncEnabled ? "primary" : "tertiary"} type="submit">
          {inventorySyncEnabled ? "Enabled" : "Disabled"}
        </s-button>
      </Form>
    </s-stack>

    <s-divider />

    <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
      <s-stack direction="block" gap="small">
        <s-text type="strong">Cross-channel delisting</s-text>
        <s-text color="subdued">
          Remove from eBay when a card sells on another marketplace.
        </s-text>
      </s-stack>
      <Form method="post">
        <input type="hidden" name="intent" value="toggle-cross-channel-delist" />
        <s-button variant={crossChannelDelistEnabled ? "primary" : "tertiary"} type="submit">
          {crossChannelDelistEnabled ? "Enabled" : "Disabled"}
        </s-button>
      </Form>
    </s-stack>
  </>
)}
```

- [ ] **Step 4: Gate inventory webhook**

In `app/routes/webhooks.inventory.update.tsx`, after fetching the eBay account for the shop (need to add this lookup), check the setting:

```typescript
import db from "../db.server";
import { getAccountSettings } from "../lib/account-settings.server";

// After the productGid is resolved and before the listings check, add:
const ebayAccount = await db.marketplaceAccount.findUnique({
  where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
});

if (ebayAccount) {
  const settings = getAccountSettings(ebayAccount);
  if (!settings.inventorySyncEnabled) {
    console.log("Inventory sync disabled — skipping");
    return new Response();
  }
}
```

Note: Place this check early, before the `db.marketplaceListing.findMany` query, to avoid unnecessary DB reads.

- [ ] **Step 5: Gate orders webhook**

In `app/routes/webhooks.orders.create.tsx`, add the setting check before processing line items:

```typescript
import db from "../db.server";
import { getAccountSettings } from "../lib/account-settings.server";

// After the authenticate line, before the lineItems loop:
const ebayAccount = await db.marketplaceAccount.findUnique({
  where: { shopId_marketplace: { shopId: shop, marketplace: "ebay" } },
});

if (ebayAccount) {
  const settings = getAccountSettings(ebayAccount);
  if (!settings.crossChannelDelistEnabled) {
    console.log("Cross-channel delisting disabled — skipping");
    return new Response();
  }
}
```

- [ ] **Step 6: Run tests + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add app/routes/app.ebay.tsx app/routes/webhooks.inventory.update.tsx app/routes/webhooks.orders.create.tsx
git commit -m "feat: wire inventory sync and cross-channel delist toggles on eBay page"
```

---

## Task 3: Extract reconciliation logic and add manual trigger

**Files:**
- Modify: `app/lib/sync-engine.server.ts` — Add `reconcileShop()` function
- Modify: `app/routes/api.reconcile.tsx` — Call extracted function
- Modify: `app/routes/app.ebay.tsx` — Add reconcile action + button

- [ ] **Step 1: Extract `reconcileShop()` into sync-engine**

Add to `app/lib/sync-engine.server.ts`:

```typescript
export interface ReconcileResult {
  delisted: number;
  relisted: number;
  errors: number;
  checked: number;
}

const INVENTORY_QUERY = `
  query productInventory($id: ID!) {
    product(id: $id) {
      totalInventory
    }
  }
`;

/**
 * Reconcile inventory state for a single shop.
 * Delists active listings with 0 inventory, relists delisted listings with restored inventory.
 */
export async function reconcileShop(
  shopId: string,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
): Promise<ReconcileResult> {
  let shopDelisted = 0;
  let shopRelisted = 0;
  let shopErrors = 0;

  const activeListings = await db.marketplaceListing.findMany({
    where: { shopId, status: "active" },
    select: { shopifyProductId: true, marketplace: true, id: true },
  });

  const delistedListings = await db.marketplaceListing.findMany({
    where: { shopId, status: "delisted" },
    select: { shopifyProductId: true, marketplace: true, id: true },
  });

  const productIds = [
    ...new Set([
      ...activeListings.map((l) => l.shopifyProductId),
      ...delistedListings.map((l) => l.shopifyProductId),
    ]),
  ];

  const inventoryByProduct = new Map<string, number>();
  for (const productId of productIds) {
    try {
      const response = await admin.graphql(INVENTORY_QUERY, {
        variables: { id: productId },
      });
      const { data } = (await response.json()) as {
        data: { product: { totalInventory: number } | null };
      };
      inventoryByProduct.set(productId, data.product?.totalInventory ?? 0);
    } catch {
      inventoryByProduct.set(productId, 0);
    }
  }

  for (const listing of activeListings) {
    const qty = inventoryByProduct.get(listing.shopifyProductId) ?? 0;
    if (qty === 0) {
      try {
        const results = await delistFromAllExcept(shopId, listing.shopifyProductId);
        shopDelisted += results.filter((r) => r.success).length;
        shopErrors += results.filter((r) => !r.success).length;
      } catch {
        shopErrors++;
      }
    }
  }

  for (const listing of delistedListings) {
    const qty = inventoryByProduct.get(listing.shopifyProductId) ?? 0;
    if (qty > 0) {
      try {
        const results = await relistAll(shopId, listing.shopifyProductId);
        shopRelisted += results.filter((r) => r.success).length;
        shopErrors += results.filter((r) => !r.success).length;
      } catch {
        shopErrors++;
      }
    }
  }

  await db.syncLog.create({
    data: {
      shopId,
      marketplace: "all",
      action: "reconcile",
      status: shopErrors > 0 ? "error" : "success",
      details: JSON.stringify({
        checked: productIds.length,
        delisted: shopDelisted,
        relisted: shopRelisted,
        errors: shopErrors,
      }),
    },
  });

  return { delisted: shopDelisted, relisted: shopRelisted, errors: shopErrors, checked: productIds.length };
}
```

- [ ] **Step 2: Update api.reconcile.tsx to use extracted function**

Replace the body of the shop loop in `app/routes/api.reconcile.tsx` with a call to `reconcileShop()`. Remove the `INVENTORY_QUERY`, per-shop listing queries, inventory fetch loop, delist/relist loops, and syncLog creation — all now inside `reconcileShop()`.

```typescript
import { reconcileShop } from "../lib/sync-engine.server";

// Inside the for loop, after getting admin:
const result = await reconcileShop(shopId, admin);
totalDelisted += result.delisted;
totalRelisted += result.relisted;
totalErrors += result.errors;
```

Remove the `INVENTORY_QUERY` constant and `delistFromAllExcept`/`relistAll` imports from this file (they're now used inside sync-engine).

- [ ] **Step 3: Add reconcile action to eBay page**

In `app/routes/app.ebay.tsx` action function, add:

```typescript
  if (intent === "reconcile") {
    const { admin } = await authenticate.admin(request);
    const result = await reconcileShop(shop, admin);
    return Response.json({
      success: true,
      message: `Reconciled: ${result.delisted} delisted, ${result.relisted} relisted, ${result.errors} errors`,
      ...result,
    });
  }
```

Import `reconcileShop` from `../lib/sync-engine.server` and `authenticate` is already imported.

Note: The action already has `authenticate.admin` available via the session extraction at the top. However, the current action only destructures `{ session }`. We need `{ admin, session }` for the reconcile intent. Update the destructure at the top of the action.

- [ ] **Step 4: Add Reconcile Now button to UI**

In the Sync Settings section, after the cross-channel delist toggle:

```tsx
{connected && <s-divider />}

{connected && (
  <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
    <s-stack direction="block" gap="small">
      <s-text type="strong">Reconciliation</s-text>
      <s-text color="subdued">
        Check all listings against current inventory and correct any drift.
      </s-text>
    </s-stack>
    <Form method="post">
      <input type="hidden" name="intent" value="reconcile" />
      <s-button type="submit">Reconcile Now</s-button>
    </Form>
  </s-stack>
)}
```

- [ ] **Step 5: Run tests + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add app/lib/sync-engine.server.ts app/routes/api.reconcile.tsx app/routes/app.ebay.tsx
git commit -m "feat: extract reconcileShop and add manual reconcile trigger on eBay page"
```

---

## Task 4: Add eBay read functions and bulk listing import

**Files:**
- Modify: `app/lib/adapters/ebay.server.ts` — Add `getInventoryItem()` and `getOffersForSku()`
- Modify: `app/routes/app.ebay.tsx` — Add import action + UI

- [ ] **Step 1: Add eBay read functions**

Add to `app/lib/adapters/ebay.server.ts`:

```typescript
/**
 * Check if an inventory item exists on eBay for the given SKU.
 * Returns null if not found (404).
 */
export async function getInventoryItem(
  sku: string,
  account: MarketplaceAccount,
): Promise<{ sku: string; exists: boolean } | null> {
  const { response } = await ebayApiCall(
    "GET",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    null,
    account,
  );

  if (response.ok) {
    return { sku, exists: true };
  }
  if (response.status === 404) {
    return null;
  }

  return null;
}

/**
 * Get offers for a SKU. Returns the first offer's ID and listing ID if found.
 */
export async function getOffersForSku(
  sku: string,
  account: MarketplaceAccount,
): Promise<{ offerId: string; listingId: string } | null> {
  const { response } = await ebayApiCall(
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=1`,
    null,
    account,
  );

  if (!response.ok) return null;

  const data = await response.json();
  const offer = data.offers?.[0];
  if (!offer) return null;

  return {
    offerId: offer.offerId ?? "",
    listingId: offer.listing?.listingId ?? "",
  };
}
```

- [ ] **Step 2: Add import action to eBay page**

In `app/routes/app.ebay.tsx` action function, add:

```typescript
import { getAllProducts } from "../lib/shopify-helpers.server";
import * as ebayAdapter from "../lib/adapters/ebay.server";

  if (intent === "import-listings") {
    const { admin } = await authenticate.admin(request);
    const account = await db.marketplaceAccount.findFirst({
      where: { shopId: session.shop, marketplace: "ebay" },
    });
    if (!account) return Response.json({ error: "Not connected" }, { status: 400 });

    const products = await getAllProducts(admin, { query: "status:active" });
    const results = { imported: 0, skipped: 0, notFound: [] as string[] };

    for (const p of products) {
      if (!p.variant) continue;

      const productId = p.product.id as string;
      const sku = p.variant.sku || `CY-${productId.split("/").pop()}`;

      // Skip if already tracked
      const existing = await db.marketplaceListing.findUnique({
        where: {
          shopId_shopifyProductId_marketplace: {
            shopId: session.shop,
            shopifyProductId: productId,
            marketplace: "ebay",
          },
        },
      });
      if (existing) {
        results.skipped++;
        continue;
      }

      // Check eBay for this SKU
      const item = await ebayAdapter.getInventoryItem(sku, account);
      if (!item) {
        results.notFound.push(`${p.product.title} (SKU: ${sku})`);
        continue;
      }

      // Get offer/listing IDs
      const offer = await ebayAdapter.getOffersForSku(sku, account);

      await db.marketplaceListing.create({
        data: {
          shopId: session.shop,
          shopifyProductId: productId,
          marketplace: "ebay",
          marketplaceId: offer?.listingId ?? "",
          offerId: offer?.offerId ?? "",
          status: "active",
          lastSyncedAt: new Date(),
        },
      });
      results.imported++;

      // Rate limit: 100ms between eBay API calls
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await db.syncLog.create({
      data: {
        shopId: session.shop,
        marketplace: "ebay",
        action: "import",
        status: "success",
        details: JSON.stringify(results),
      },
    });

    return Response.json({
      success: true,
      message: `Imported ${results.imported} listings. ${results.skipped} already tracked. ${results.notFound.length} not found on eBay.`,
      ...results,
    });
  }
```

Note: This intent also needs `admin`, so it must destructure `{ admin, session }` from `authenticate.admin(request)`. This was already updated in Task 3 for the reconcile intent.

- [ ] **Step 3: Add Import button to UI**

In the Sync Settings section, after the Reconcile Now block:

```tsx
{connected && <s-divider />}

{connected && (
  <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
    <s-stack direction="block" gap="small">
      <s-text type="strong">Import existing listings</s-text>
      <s-text color="subdued">
        Scan eBay for listings matching your Shopify product SKUs and import
        them into Card Yeti for tracking. Safe to run multiple times.
      </s-text>
    </s-stack>
    <Form method="post">
      <input type="hidden" name="intent" value="import-listings" />
      <s-button type="submit">Import from eBay</s-button>
    </Form>
  </s-stack>
)}
```

- [ ] **Step 4: Run tests + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add app/lib/adapters/ebay.server.ts app/routes/app.ebay.tsx
git commit -m "feat: add bulk eBay listing import by SKU"
```

---

## Task 5: Add configurable Shopify discount percentage

**Files:**
- Modify: `app/routes/app.sync-rules.tsx` — Add discount % input per marketplace
- Modify: `app/routes/api.prices.tsx` — Read discount from DB

- [ ] **Step 1: Add discount input to sync rules page**

In `app/routes/app.sync-rules.tsx`, in the loader, also read `discountPercent` from each account's settings:

```typescript
import { getAccountSettings } from "../lib/account-settings.server";

// In loader, alongside rulesByMarketplace:
const discountByMarketplace: Record<string, number> = {};
for (const account of accounts) {
  const settings = getAccountSettings(account);
  discountByMarketplace[account.marketplace] = settings.discountPercent;
}

return { rulesByMarketplace, discountByMarketplace, connectedMarketplaces: accounts.map((a) => a.marketplace) };
```

In the action, read and save the discount:

```typescript
const discountRaw = formData.get("discountPercent")?.toString();
const discountPercent = discountRaw ? parseFloat(discountRaw) : 5;

// Add to the settings update:
const newSettings = {
  ...currentSettings,
  syncRules: syncRules as unknown as Prisma.InputJsonValue,
  discountPercent,
};
```

In the component, add a "Pricing" section within each marketplace's form, after the auto-sync checkbox:

```tsx
<s-divider />

<label htmlFor={`discountPercent-${mp}`}>
  <s-text type="strong">Shopify Discount %</s-text>
</label>
<s-text color="subdued">
  Shopify storefront price will be this much lower than the marketplace listing price.
</s-text>
<input
  id={`discountPercent-${mp}`}
  type="number"
  name="discountPercent"
  defaultValue={discountByMarketplace[mp] ?? 5}
  min="0"
  max="100"
  step="0.5"
  style={{ width: "100px", padding: "0.5rem" }}
/>
```

- [ ] **Step 2: Update api.prices.tsx to read discount from DB**

In `app/routes/api.prices.tsx`, replace the hardcoded constant:

```typescript
// Remove: const SHOPIFY_DISCOUNT = 0.05;

// In the action function, after authenticate.admin:
import { getAccountSettings } from "../lib/account-settings.server";

// Read discount from first connected marketplace account
const account = await db.marketplaceAccount.findFirst({
  where: { shopId: session.shop },
});
const discountPercent = account
  ? getAccountSettings(account).discountPercent
  : 5;
const shopifyDiscount = discountPercent / 100;

// Then use shopifyDiscount instead of SHOPIFY_DISCOUNT:
const newPrice = (parseFloat(csvPrice) * (1 - shopifyDiscount)).toFixed(2);
```

- [ ] **Step 3: Run tests + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add app/routes/app.sync-rules.tsx app/routes/api.prices.tsx app/lib/account-settings.server.ts
git commit -m "feat: configurable Shopify discount percentage per marketplace"
```

---

## Verification

After all tasks are complete:

- [ ] **Run full test suite:** `npx vitest run` — all pass
- [ ] **Run type check:** `npx tsc --noEmit` — clean
- [ ] **Run linter:** `npm run lint` — no new warnings
- [ ] **Verify toggles:** Read `app.ebay.tsx` and confirm inventory sync + cross-channel delist toggles have form handlers + UI
- [ ] **Verify auto-sync toggle removed:** Confirm no "Auto-sync new products" switch on eBay page (only on Sync Rules page)
- [ ] **Verify reconcile:** Read `app.ebay.tsx` action and confirm `reconcile` intent calls `reconcileShop()`
- [ ] **Verify import:** Read `app.ebay.tsx` action and confirm `import-listings` intent queries eBay by SKU
- [ ] **Verify discount:** Read `api.prices.tsx` and confirm `SHOPIFY_DISCOUNT` constant is replaced with DB read
