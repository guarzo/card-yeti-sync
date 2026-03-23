# Dashboard Redesign - Design Spec

## Problem

The current Card Yeti Sync dashboard is a single-column vertical stack of full-width cards. Marketplace connections, recent activity, and products all receive equal visual weight, making it hard to scan. The layout wastes horizontal space and doesn't answer the three questions users come to the dashboard for:

1. Are all my marketplaces healthy?
2. What happened since I last checked?
3. Do I have problems to fix?

## User Profile

- Multi-channel Pokemon card sellers with 200-1,000 products
- Most use 2+ marketplaces, many use all four (Shopify + eBay, Whatnot, Helix)
- Primary workflow: add products or update prices in Shopify, then check that syncs propagated correctly
- Card Yeti competes against established services — the UI must look polished and trustworthy

## Design: Priority-Driven Dashboard

The dashboard is reorganized into five distinct zones with clear visual hierarchy, ordered by urgency.

### Zone 1: Attention Zone (conditional)

Only renders when there are actionable problems. Completely absent when everything is healthy.

**Banner types (ordered by severity):**

| Tone | Trigger | Example |
|------|---------|---------|
| Critical | Listing sync errors exist | "3 listings failed to sync" + link to error details |
| Warning | Marketplace token expiring within 7 days | "eBay token expires in 2 days" + refresh link |
| Info | A marketplace is not connected | "Whatnot is not connected" + setup link |
| Info | Price suggestions awaiting review | "12 price suggestions ready for review" + link |

Multiple banners can stack when there are multiple issues (e.g., expired eBay token + Whatnot errors). They render in severity order: critical first, then warning, then info.

When healthy, users see stats first — no wasted vertical space on "everything is fine" banners.

### Zone 2: Stat Row

Five compact inline metric cards in a horizontal row:

| Total Products | Active Listings | Price Reviews | Pending Syncs | Errors |
|---|---|---|---|---|
| 487 | 1,412 | 12 | 3 | 0 |

- **Total Products**: Count from Shopify (source of truth)
- **Active Listings**: Aggregate across all connected marketplaces (a product on 3 marketplaces = 3 listings). This is a new derived metric computed from the existing `MarketplaceListing` groupBy query (`status = "active"`), not the existing `activeProductCount` from Shopify
- **Price Reviews**: Count of pending Card Yeti price suggestions awaiting user approval
- **Pending Syncs**: Listings in "pending" status
- **Errors**: Listings in "error" status

Stat cards use subdued background for visual weight. "Price Reviews" and "Errors" highlight (badge tone) when non-zero.

**Stat card click targets:**
- Total Products → scrolls to Zone 5 (products table)
- Active Listings → scrolls to Zone 5
- Price Reviews → scrolls to Zone 5 with "pending price review" filter applied
- Pending Syncs → scrolls to Zone 5 with "pending" status filter applied
- Errors → scrolls to Zone 5 with "error" status filter applied

### Zone 3: Marketplace Health Tiles

A 4-across responsive grid (collapses to 2x2 on narrow viewports). The four tiles are: Shopify (always first) + the three marketplace channels (eBay, Whatnot, Helix).

**Shopify tile (always connected, source of truth):**
- Store icon + "Shopify" (bold)
- Key metric: "{N} products" prominently displayed
- "{N} active" secondary stat
- Green "Source of truth" badge
- No manage link (users manage products in Shopify admin)

**Connected marketplace tile:**
- Marketplace icon + name (bold)
- Key metric: "{N} active" prominently displayed
- Secondary stat: "{N} pending" or "{N} errors" if non-zero
- Green "Connected" badge
- Subtle "Manage" link to marketplace detail page

**Disconnected tile:**
- Same dimensions as connected tiles (visual consistency)
- Muted/subdued styling
- Neutral "Not connected" badge
- "Set up" CTA button

All four marketplace states are scannable in a single glance without scrolling.

### Zone 4: Two-Column Middle

**Left column (~60%): Recent Activity**

Table of the last 10-15 sync events:

| Column | Content |
|--------|---------|
| Action | Icon + formatted type (Listed, Delisted, Price Update, Reconciled) |
| Product | Product title (resolved from `SyncLog.details.productTitle` — the loader must denormalize the title into the log's JSON details field at write time) |
| Marketplace | Marketplace name |
| Status | Success/error badge |
| Time | Relative timestamp ("2h ago") |

Action types are color-coded by icon tone:
- Listed = success (green)
- Delisted = neutral
- Price Update = info (blue)
- Error = critical (red)
- Reconciled = caution (yellow)

Empty state: centered icon + "No sync activity yet" heading + "Connect a marketplace and sync products to see activity here."

**Right column (~40%): Sync Summary**

A compact card showing "Listings by Marketplace" — a simple count per connected marketplace (e.g., eBay: 142, Whatnot: 89, Helix: 0). Gives a quick answer to "did my products sync everywhere?" without scanning the full products table.

Below the marketplace counts, show a "Products awaiting first sync" count if any products have zero marketplace listings. This is computed from the loader data (products with no corresponding `MarketplaceListing` records).

### Zone 5: Products - Sync Status View

This is **not** a duplicate of Shopify's product catalog. It focuses entirely on sync state and price management across marketplaces.

**Columns:**

| Column | Content |
|--------|---------|
| Product | Thumbnail + title (links to Shopify product page) |
| Price | Current Shopify price |
| Suggested | Card Yeti's suggested price (only when pending). Shows new price + "Approve" action button |
| {Marketplace} | One column per **connected** marketplace. Status indicator: ✓ active, ⚠ error (tooltip with message), ○ pending, — not listed |
| Last Synced | Relative timestamp |

**Behavior:**
- Default sort: most recently synced first
- Filterable by status (errors first, pending, all)
- Marketplace columns are dynamic — only connected marketplaces appear
- **Approve action**: Submits a React Router form action with `intent: "approve-price"` and the suggestion ID. The action updates the `PriceSuggestion` status to "approved", updates the Shopify product price via GraphQL mutation, and queues marketplace price syncs. On success, the page revalidates. On error, a toast/banner shows the failure.
- **Bulk approve**: A "Review All" button above the products table opens a modal listing all pending suggestions with a "Select All" checkbox and per-row checkboxes. Submitting approves selected suggestions sequentially. Partial failures are reported per-item.
- **Pagination**: Server-side cursor-based pagination using Shopify GraphQL cursors for products and Prisma cursor pagination for listings. URL query params (`?after=cursor&filter=errors`) control page and filter state. Default page size: 25 products. Filter options: All, Errors, Pending, Price Reviews.

**Empty state:** "No products found" + "Add Pokemon cards to your Shopify store to start syncing across marketplaces. Products with card metafields (pokemon, set name, grade) will get rich listings on every channel." + "Add a product" button

## Visual Design Principles

- **Consistent spacing rhythm**: Use Polaris `s-box` padding tokens for uniform spacing throughout
- **Subdued stat card backgrounds**: Light background tint to create visual weight separation from content sections
- **Badge tone consistency**: success=green (active/connected), critical=red (errors), warning=yellow (expiring tokens), info=blue (suggestions/setup)
- **No orphaned sections**: Empty states feel intentional and guide users toward the next action
- **Progressive disclosure**: Problems surface at the top; details are available deeper
- **Responsive**: 4-across tiles collapse to 2x2; two-column middle collapses to stacked on narrow viewports

## Technical Constraints

- Built with Shopify Polaris Web Components (`s-*` elements)
- Server-side data loading via React Router v7 loaders
- No client-side state library — all data comes from the loader
- Must remain SSR-safe (relative timestamps use the existing `RelativeTime` component with `suppressHydrationWarning`)
- Existing reusable components: `StatCard`, `EmptyState`, `RelativeTime`
- `ConnectionCard` is used on marketplace detail pages (eBay, Whatnot, Helix) but is **not** reused for Zone 3 tiles — the dashboard tiles are a distinct, more compact layout
- Dynamic table columns: Zone 5 marketplace columns are constructed programmatically from the connected marketplaces list, so the `s-table-header-row` is built dynamically

## Data Requirements

**Existing data (already available in loader):**
- Products with count/active count (Shopify GraphQL)
- Marketplace accounts with connection status, token expiry
- Marketplace listings with status per product per marketplace
- Sync logs (last 10)

**New data needed:**

- **PriceSuggestion table** (new Prisma model):
  ```
  model PriceSuggestion {
    id                String   @id @default(cuid())
    shopId            String
    shopifyProductId  String
    currentPrice      Decimal
    suggestedPrice    Decimal
    status            String   @default("pending")  // "pending" | "approved" | "rejected"
    reason            String?                        // why Card Yeti suggested this price
    reviewedAt        DateTime?
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt

    @@unique([shopId, shopifyProductId, status])     // one pending suggestion per product
    @@index([shopId, status])
  }
  ```
- **SyncLog.details must include productTitle**: When writing sync logs, denormalize the product title into the JSON details field so the dashboard can display it without additional Shopify API calls
- Aggregate listing counts per marketplace: derived from existing `MarketplaceListing` groupBy query (`GROUP BY marketplace, status WHERE shopId = ?`)
- Pending sync count: `MarketplaceListing` count where `status = "pending"`
- Error count: `MarketplaceListing` count where `status = "error"`
- Active listings aggregate: `MarketplaceListing` count where `status = "active"` (new metric, distinct from Shopify's `activeProductCount`)

## Out of Scope

- Shopify product editing or creation (users do this in Shopify admin)
- Marketplace-specific settings (handled on individual marketplace pages)
- Price suggestion algorithm / pricing engine (separate feature — this spec only covers the dashboard UI for reviewing suggestions that already exist in the database)
- Notification system or email alerts
