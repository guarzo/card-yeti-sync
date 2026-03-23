# Product Requirements Document — Card Yeti Sync

## Problem

Pokemon card sellers who use Shopify as their primary store face three pain points when selling across multiple marketplaces:

1. **eBay policy assignment is manual.** Shopify Marketplace Connect cannot auto-assign eBay business policies (shipping, payment, returns) to new listings. Every new product requires manual policy configuration in eBay Seller Hub, or it defaults to "collection only" with no shipping.

2. **No automated Whatnot sync.** Sellers manually export CSVs and upload them to Whatnot's Seller Hub. There's no way to track what's been exported, and no cross-channel inventory sync.

3. **New marketplaces have no integration path.** Emerging platforms like Helix offer lower fees and better tools for card sellers, but have no programmatic seller integration. Sellers must manually cross-list inventory.

Across all three: when a card sells on one channel, the seller must manually delist it everywhere else — or risk overselling a one-of-one collectible.

## Solution

A public Shopify app that syncs inventory from Shopify to external marketplaces, with:

- **Webhook-driven sync**: Product and inventory changes in Shopify automatically propagate to connected marketplaces
- **Cross-channel delist**: When a card sells anywhere, it's delisted everywhere else within seconds
- **Marketplace adapter architecture**: Consistent interface per marketplace, making it straightforward to add new channels
- **Rich card metadata**: Maps Shopify's 19 custom metafields to each marketplace's native format

## Target Users

Pokemon card sellers on Shopify who sell across 2+ channels. Primarily small businesses and solo sellers who:

- Sell graded slabs (PSA, CGC, BGS, SGC), raw singles, Japanese imports, and sealed product
- List on eBay, Whatnot, and/or Helix
- Manage quantity-1 inventory (each card is unique)
- Need cross-channel inventory sync to prevent double-sells

## User Stories

### eBay Integration

**As a seller, I want to connect my eBay account and have new Shopify products automatically listed on eBay with correct shipping/payment/return policies**, so I don't have to manually configure policies for every new listing.

Acceptance criteria:
- OAuth flow to connect eBay seller account
- Create and manage eBay business policies (fulfillment, payment, return) from the app
- New products synced to eBay include correct policy IDs
- Card metafields (pokemon, set, number, grade, cert, etc.) map to eBay item specifics
- Price mapping: eBay price = Shopify `compareAtPrice` (market comp)
- Bulk initial sync for existing inventory (up to 25 per API call)
- Support `--dry-run` equivalent (preview mode)

**As a seller, I want products that sell on eBay to be automatically delisted from Shopify and other marketplaces**, so I don't oversell.

Acceptance criteria:
- eBay order notifications received via Notification API
- Shopify inventory set to 0 for sold products
- Other marketplace listings delisted

### Whatnot Integration

**As a seller, I want to generate a Whatnot-compatible CSV from my Shopify inventory with one click**, including all card types (graded, raw, sealed) with rich descriptions.

Acceptance criteria:
- CSV export from the app's admin UI
- Supports graded cards, raw singles, and sealed product
- Description includes all relevant metafield data (set, number, grade, cert, condition, centering, population)
- "Export new only" option tracks previously exported products
- Correct shipping profile mapping per product type

**As a seller, I want real-time Whatnot sync when their API becomes available**, without changing my workflow.

Acceptance criteria:
- When Whatnot Seller API access is granted, the CSV adapter is replaced with an API adapter
- Same UI, same sync rules — underlying transport changes transparently

### Helix Integration

**As a seller, I want to sync my inventory to Helix to access lower fees (4.9%) and their real-time pricing data.**

**Phase 1 (CSV, current):** CSV export matching the proposed Helix listing schema, with in-app export controls and recency tracking. Price updates imported via CSV download/upload workflow.

**Phase 2 (API, when available):** The CSV adapter is replaced with a full API adapter — same UI, same sync rules, underlying transport changes transparently.

Acceptance criteria:
- CSV export with full card metadata mapped to Helix schema (Phase 1)
- Connect Helix account via OAuth (Phase 2)
- Bulk sync inventory with structured data: pokemon, set, number, grade, cert, population, condition, centering
- Cross-channel delist on sale
- Pull Helix pricing data (bid/ask, recent sales, trends) to inform pricing across all channels (Phase 2)

### Cross-Channel Inventory

**As a seller, I want a single dashboard showing sync status across all my marketplace connections.**

Acceptance criteria:
- Dashboard shows: total synced per marketplace, last sync time, errors
- Per-product sync status visible (active, delisted, error, pending)
- Activity log showing recent sync operations
- Manual sync/delist buttons per product per marketplace

**As a seller, I want periodic reconciliation to catch any drift between Shopify and marketplace inventory.**

Acceptance criteria:
- Scheduled job (every 15 minutes) compares Shopify inventory with marketplace state
- Automatically corrects mismatches (delist if qty=0, relist if qty>0)
- Logs all corrections for audit

### Product Admin Block

**As a seller, I want to see marketplace sync status directly on the Shopify product page**, not just in the app.

Acceptance criteria:
- Admin block extension on product detail page
- Shows: sync status per marketplace, listing URLs, last sync timestamp
- Quick actions: manual sync, delist

## Data Model

### Shopify Product Metafields (Card Namespace)

19 fields that capture the full card data model:

| Field | Type | Used For |
|-------|------|----------|
| `pokemon` | text | Card identity |
| `set_name` | text | Card identity |
| `number` | text | Card identity |
| `language` | text | Card identity |
| `year` | text | Card identity |
| `rarity` | text | Card identity |
| `grading_company` | text | Grading |
| `grade` | text | Grading |
| `cert_number` | text | Grading |
| `cert_url` | url | Grading |
| `population` | integer | Grading |
| `pop_higher` | integer | Grading |
| `subgrades` | text | Grading (BGS) |
| `condition` | text | Raw card condition |
| `condition_notes` | multi_line_text | Raw card condition |
| `centering` | text | Raw card condition |
| `ebay_comp` | decimal | Market pricing |
| `type_label` | text | Product type |
| `ebay_item_id` | text | Source tracking |

### App Database (Prisma)

- **MarketplaceAccount** — Per-shop, per-marketplace. Stores OAuth tokens (encrypted), policy IDs, sync rules, pricing rules.
- **MarketplaceListing** — Per-shop, per-product, per-marketplace. Tracks listing ID, offer ID (eBay), status, last sync, errors.
- **SyncLog** — Append-only audit trail. Action, marketplace, product, status, details, timestamp.

## Marketplace Adapter Interface

Each marketplace implements:

```
listProduct(product, metafields, settings)  → { marketplaceId, url, status }
updateProduct(marketplaceId, product, metafields) → { status }
delistProduct(marketplaceId)                → { status }
updateInventory(marketplaceId, quantity)     → { status }
updatePrice(marketplaceId, price)            → { status }
```

## Sync Flow

### Outbound (Shopify → Marketplaces)

1. Shopify webhook fires (`products/create`, `products/update`, `inventory_levels/update`)
2. App identifies which marketplace connections are active for this shop
3. For each marketplace: check sync rules (collection, type, tags), map data, call adapter
4. Store listing state in MarketplaceListing, log to SyncLog

### Inbound (Marketplace → Shopify)

1. Marketplace webhook/notification fires (eBay `ORDER_CONFIRMATION`, Helix `order.created`)
2. App identifies the sold product via marketplace listing ID
3. Set Shopify inventory to 0
4. Trigger outbound delist to all OTHER marketplaces

### Reconciliation

1. QStash cron hits `/api/reconcile` every 15 minutes
2. Fetch all active Shopify products for the shop
3. Compare with MarketplaceListing state
4. Correct any drift, log corrections

## Phases

### Phase 1: Scaffold + Helix Proposal
- App scaffold (React Router v7, Prisma, Fly.io)
- Multi-tenant database schema
- Dashboard with product overview
- Marketplace settings pages (eBay, Whatnot, Helix)
- Webhook handler stubs
- Helix integration proposal document

### Phase 2: eBay Direct Integration
- eBay OAuth (authorization code grant)
- Business policy management (Account API)
- Listing creation (Inventory API) with auto-policy attachment
- Metafield → eBay item specifics mapping
- `products/update` webhook → auto-sync to eBay

### Phase 3: Cross-Channel Inventory
- `orders/create` + `inventory_levels/update` webhook handlers
- Cross-channel delist logic
- eBay Notification API (inbound sale notifications)
- Dashboard: sync status, activity log, errors
- QStash periodic reconciliation
- Product admin block extension

### Phase 4: Whatnot + Helix Adapters
- Whatnot CSV export from admin UI
- Helix API adapter (when their API ships)
- Whatnot API adapter (when Seller API opens)
- Helix pricing data integration

### Phase 5: Migration + Polish
- Migrate Marketplace Connect listings to direct eBay integration
- Sync rules UI (by collection, type, tags)
- Price rules per marketplace
- Disable Marketplace Connect

## Non-Goals (for now)

- **Multi-TCG support** — This is Pokemon-only. Magic/Yu-Gi-Oh support may come later but is not in scope.
- **Public App Store listing** — We'll develop with Card Yeti as the test store and expand to other sellers before submitting to the App Store.
- **Mobile app** — The embedded Shopify admin UI works on mobile via the Shopify app.
- **Import from marketplaces** — This is outbound sync only. The existing CLI scripts in the `yeti-shop` repo handle imports.

## Success Metrics

- Zero manual eBay policy assignments needed for new listings
- < 5 minute lag between Shopify product change and marketplace listing update
- < 1 minute cross-channel delist after a sale
- Zero double-sells due to inventory sync failure
