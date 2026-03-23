# Card Yeti Sync — Implementation Status

**Status:** All planned phases complete. App deployed to production on Fly.io.

**Architecture:** Marketplace adapter pattern — eBay gets a full API adapter; Whatnot and Helix use CSV export adapters (APIs not yet available). A central sync engine orchestrates cross-channel operations. Price management uses CSV download/upload. All routes use Shopify's embedded app authentication.

**Tech Stack:** React Router v7, Shopify Polaris Web Components, Prisma ORM (PostgreSQL), TypeScript, Vitest, eBay Sell Inventory/Account APIs

---

## Completed Phases

### Phase 1: Scaffold + Infrastructure
- App scaffold (React Router v7, Prisma, Fly.io, PostgreSQL)
- Multi-tenant database schema (6 models: Session, MarketplaceAccount, MarketplaceListing, SyncLog, OAuthNonce, PriceSuggestion)
- Dashboard with 5-zone priority layout (AttentionZone, MarketplaceTiles, SyncSummary, ProductsSyncTable, BulkApproveModal)
- GDPR webhook handlers (customers/data_request, customers/redact, shop/redact, app/uninstalled)
- HMAC state validation for OAuth CSRF protection
- CI pipeline (GitHub Actions: typecheck, lint, Prisma validation, migration drift, tests, build)
- Automatic Fly deployment on merge to main

### Phase 2: eBay Integration
- eBay OAuth (authorization code grant with HMAC-signed state + single-use nonce)
- Business policy management (create fulfillment, payment, return policies via Account API)
- Listing creation via Sell Inventory API (inventory item → offer → publish)
- Listing update and delist (withdraw) operations
- Card metafield → eBay item specifics mapping (19 metafields)
- Product create/update webhooks wired to eBay adapter
- Sync rules enforcement (product type, tags, price range, auto-sync toggle)
- Shadow mode for safe parallel validation alongside Marketplace Connector
- eBay marketplace account deletion notification endpoint (GDPR requirement)

### Phase 3: Cross-Channel Inventory
- Sync engine: `delistFromAllExcept()` and `relistAll()` orchestration
- `orders/create` webhook → cross-channel delist when card sells on Shopify
- `inventory_levels/update` webhook → delist on qty=0, relist on qty restored (resolves inventory_item_id → product_id via Admin API)
- QStash reconciliation cron (`/api/reconcile`) with timing-safe auth and per-shop counter scoping
- Product admin block extension showing per-marketplace listing status on product detail page

### Phase 4: CSV Exports + Price Management
- Whatnot CSV export (21 columns, auto-built descriptions, shipping profile by product type)
- Helix CSV export (29 columns, full card metadata)
- Both support "Export All" and "Export New Only" modes with listing tracking
- Price CSV download (all products with current prices)
- Price CSV upload with dry-run mode and 5% Shopify discount calculation
- Shared CSV utilities (escape, generate) extracted for DRY
- Batched marketplace listing upserts for performance

### Phase 5: Sync Rules + Polish
- Per-marketplace sync rules (product types, exclude tags, price range, auto-sync new)
- Sync rules enforced in product create/update webhooks before eBay listing
- Privacy policy page
- Code review fixes (timing-safe auth, conditional syncLog, extracted helpers)

### Phase 6: Sync Settings, Bulk Ops & Price Rules
- Inventory sync toggle (enable/disable `inventory_levels/update` webhook per marketplace)
- Cross-channel delisting toggle (enable/disable `orders/create` delist per marketplace)
- Manual reconciliation trigger ("Reconcile Now" button on eBay page)
- Bulk eBay listing import by SKU (discover Marketplace Connector listings, import into Card Yeti DB with mismatch report)
- Configurable Shopify discount % per marketplace (replaces hardcoded 5%)
- Typed account settings helper with defaults

---

## Remaining / Future Work

### Whatnot API Integration
- Blocked on Whatnot Seller API exiting Developer Preview
- When available: replace CSV adapter with API adapter, same UI and sync rules

### Helix API Integration
- Blocked on Helix opening their Seller API
- Phase 1: Bulk import via OAuth
- Phase 2: Real-time webhook-driven sync
- Phase 3: Bidirectional sync + pricing data integration
- See `docs/HELIX_PROPOSAL.md` and `docs/OPTION_B_IMPLEMENTATION.md` for detailed specs

### Nice-to-haves
- eBay business policy editing from within the app
