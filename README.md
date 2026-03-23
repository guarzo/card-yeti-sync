<p align="center">
  <img src="public/card-yeti-logo.png" alt="Card Yeti" width="400" />
</p>

<p align="center">
  <strong>Multi-marketplace sync for Pokémon card sellers on Shopify</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#supported-marketplaces">Marketplaces</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#deployment">Deployment</a>
</p>

---

Card Yeti Sync is an embedded Shopify app that syncs your Pokémon card inventory across marketplaces from a single dashboard. eBay integration is live with shadow mode for safe parallel validation; Whatnot and Helix support CSV export.

<p align="center">
  <img src="docs/dashboard.jpg" alt="Card Yeti Dashboard" width="800" />
</p>

## Features

- **One dashboard for all marketplaces** — View products, listing status, and sync activity from Shopify admin
- **Automatic cross-channel delisting** — When a card sells on one channel, it's delisted everywhere else via webhooks
- **Real-time inventory sync** — Inventory changes trigger immediate delist (qty=0) or relist (qty restored)
- **Rich card metadata** — 19 custom metafields (set, number, grade, cert, condition, etc.) mapped to each marketplace's native format
- **Business policy automation** — eBay listings get shipping, payment, and return policies assigned automatically
- **Shadow mode** — Run alongside Shopify Marketplace Connector to validate sync behavior before cutting over
- **Sync rules** — Filter which products sync per marketplace by type, tags, price range
- **CSV exports** — Generate Whatnot and Helix-compatible CSVs with rich descriptions built from card metafields
- **Price management** — Download/upload price CSVs with configurable per-marketplace Shopify discount
- **Bulk eBay import** — Import existing Marketplace Connector listings by SKU for seamless migration
- **Reconciliation** — Manual trigger or periodic cron for inventory drift correction

## Supported Marketplaces

| Marketplace | Integration | Status |
|:------------|:------------|:-------|
| **eBay** | Sell API (OAuth + Inventory API) | Active |
| **Whatnot** | CSV export (API planned) | CSV Ready |
| **Helix** | CSV export (API planned) | CSV Ready |

### eBay
Direct integration via the Sell Inventory API with OAuth token management, automatic business policy assignment, and reactive token refresh. Product create/update webhooks auto-sync listings. Supports shadow mode for parallel validation alongside Marketplace Connector.

### Whatnot
Generates Whatnot Seller Hub-compatible CSVs with rich descriptions built from card metafields. Shipping profiles auto-detected by product type. Full API integration planned when the Whatnot Seller API exits Developer Preview.

### Helix
Generates Helix-compatible CSVs with full card metadata (29 columns). Integration with their real-time pricing data planned when the Seller API opens.

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Framework** | React Router v7 (SSR) |
| **UI** | Shopify Polaris Web Components |
| **Language** | TypeScript (strict mode) |
| **Database** | Prisma + PostgreSQL |
| **Build** | Vite |
| **Testing** | Vitest |
| **Hosting** | Fly.io |
| **CI/CD** | GitHub Actions → Fly Deploy |
| **Auth** | Shopify managed installation + eBay OAuth |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20.19
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- A Shopify Partner account and dev store

### Setup

```bash
# Install dependencies
npm install

# Set up the database
npx prisma migrate dev

# Start the dev server (opens in Shopify admin)
shopify app dev
```

Press `p` in the terminal to open the app URL in your browser.

## Project Structure

```text
app/
  components/                       # Shared UI components
    StatCard.tsx                     #   Reusable stat display card
    ConnectionCard.tsx               #   Marketplace connection card
    EmptyState.tsx                   #   Empty state with icon + CTA
    DisconnectButton.tsx             #   Disconnect with confirmation
    RelativeTime.tsx                 #   SSR-safe relative timestamps
    dashboard/                       #   Dashboard-specific components
      AttentionZone.tsx              #     Priority banners (errors, expiring tokens)
      MarketplaceTile.tsx            #     Marketplace health tile
      SyncSummary.tsx                #     Listings-by-marketplace counts
      ProductsSyncTable.tsx          #     Products table with dynamic marketplace columns
      BulkApproveModal.tsx           #     Bulk price suggestion review
  routes/
    app._index.tsx                   # Dashboard — 5-zone priority layout
    app.ebay.tsx                     # eBay — connect, policies, shadow mode, sync toggles, reconcile, import
    app.whatnot.tsx                  # Whatnot — CSV export, price management, inventory breakdown
    app.helix.tsx                    # Helix — CSV export, price management, roadmap
    app.sync-rules.tsx               # Sync rules — per-marketplace product filters + discount %
    app.privacy.tsx                  # Privacy policy page
    api.ebay-callback.tsx            # eBay OAuth callback
    api.ebay-notifications.tsx       # eBay marketplace account deletion (GDPR)
    api.export-whatnot.tsx           # Whatnot CSV download
    api.export-helix.tsx             # Helix CSV download
    api.prices.tsx                   # Price CSV download + upload with configurable discount
    api.product-sync-status.tsx      # Product sync status for admin block extension
    api.reconcile.tsx                # QStash cron for inventory drift reconciliation
    webhooks.products.create.tsx     # Auto-list new products on eBay (respects sync rules)
    webhooks.products.update.tsx     # Auto-update existing eBay listings
    webhooks.orders.create.tsx       # Cross-channel delist on Shopify sale
    webhooks.inventory.update.tsx    # Delist on qty=0, relist on qty restored
    webhooks.app.uninstalled.tsx     # Cleanup all data on uninstall
  lib/
    adapters/
      ebay.server.ts                 # eBay Inventory API adapter (list, update, delist, bulk, import)
    mappers/
      ebay-mapper.ts                 # Shopify product → eBay inventory item + offer
      whatnot-mapper.ts              # Shopify product → Whatnot CSV row
      helix-mapper.ts                # Shopify product → Helix CSV row
    csv-utils.ts                     # Shared CSV escape + generation
    sync-engine.server.ts            # Cross-channel delist/relist orchestration + reconciliation
    sync-rules.ts                    # SyncRules type, defaults, product type constants
    sync-rules.server.ts             # Sync rules evaluation (type, tags, price)
    account-settings.server.ts       # Typed account settings with defaults
    shadow-mode.server.ts            # Shadow mode check + eBay state comparison
    shopify-helpers.server.ts        # Product fetcher + metafield extraction
    ebay-client.server.ts            # eBay OAuth + API client
    ebay-policies.server.ts          # eBay business policy CRUD
    marketplace-config.ts            # Shared marketplace constants
    graphql-queries.server.ts        # Shared Shopify GraphQL queries
    hmac-state.server.ts             # CSRF/OAuth state validation
    ui-helpers.ts                    # Formatting utilities
    use-relative-time.ts             # SSR-safe relative time hook
  db.server.ts                       # Prisma client singleton
  shopify.server.ts                  # Shopify app configuration

extensions/
  product-sync-status/               # Shopify admin block extension
    src/BlockExtension.jsx           #   Shows per-marketplace listing status on product page
    locales/en.default.json          #   Extension translations

prisma/
  schema.prisma                      # Session, MarketplaceAccount, MarketplaceListing,
                                     # SyncLog, OAuthNonce, PriceSuggestion
```

## Data Model

```text
MarketplaceAccount ──┐
  shopId              │  1:many
  marketplace         ├──────── MarketplaceListing
  accessToken         │           shopifyProductId
  refreshToken        │           marketplaceId
  tokenExpiry         │           offerId
  settings (JSON)     │           status (active|delisted|error|pending)
    syncRules         │           lastSyncedAt
    shadowMode        │           errorMessage
    inventorySyncEnabled │
    crossChannelDelistEnabled │
    discountPercent   │
    policyIds         │
                      │
SyncLog               │
  marketplace         │
  action              │         OAuthNonce
  status              │           shopId, nonce, expiresAt
  details (JSON)      │
                      │         PriceSuggestion
                      │           shopifyProductId
                      │           currentPrice, suggestedPrice
                      │           status (pending|approved|rejected)
```

Products in Shopify use custom metafields under the `card` namespace (19 fields covering card identity, grading, condition, and commerce data). These are mapped to each marketplace's native format by the adapter layer.

## Shadow Mode

Shadow mode lets you run Card Yeti alongside Shopify Marketplace Connector to validate that sync behavior is correct before cutting over.

When enabled (per-shop toggle on the eBay settings page):
- All eBay write operations are intercepted — no listings created, updated, or delisted
- Each intended action is logged with what Card Yeti *would* have done
- eBay's actual state is read and compared against the intended action
- Matches and discrepancies are shown on the eBay settings page

Everything else remains fully functional: dashboard, CSV exports, price management, sync rules.

### Cutover workflow

1. Connect eBay account in Card Yeti
2. Enable shadow mode on the eBay settings page
3. Monitor the shadow activity log for match rate
4. When confident, disable shadow mode and remove Marketplace Connector

## Deployment

### CI/CD Pipeline

Merging to `main` triggers:
1. **CI** (GitHub Actions) — type check, lint, Prisma validation, migration drift check, tests, build
2. **Fly Deploy** — automatic deployment after CI passes

Shopify app config + extensions are deployed separately:
```bash
shopify app deploy
```
Only needed when `shopify.app.toml` or `extensions/` change.

### Manual deployment

```bash
# Deploy server to Fly.io
fly deploy

# Deploy Shopify app config + extensions
shopify app deploy

# Local db proxy
fly proxy 15432:5432 -a card-yeti-sync-db
```

### Environment Variables

Set automatically by Shopify CLI during development. For production, configure via `fly secrets set`:

| Variable | Description |
|:---------|:------------|
| `SHOPIFY_API_KEY` | App API key from Shopify Partners |
| `SHOPIFY_API_SECRET` | App API secret |
| `SHOPIFY_APP_URL` | Production app URL (e.g. `https://card-yeti-sync.fly.dev`) |
| `EBAY_CLIENT_ID` | eBay developer app ID |
| `EBAY_CLIENT_SECRET` | eBay developer app secret |
| `EBAY_RU_NAME` | eBay redirect URL name (RuName) |
| `EBAY_ENVIRONMENT` | `sandbox` or `production` |
| `EBAY_VERIFICATION_TOKEN` | Token for eBay notification endpoint validation |
| `EBAY_NOTIFICATION_ENDPOINT` | Full URL for eBay notification endpoint |
| `DATABASE_URL` | PostgreSQL connection string |
| `QSTASH_SECRET` | Bearer token for reconciliation cron (optional) |

### eBay Developer Portal Setup

| Setting | Value |
|:--------|:------|
| **OAuth Accept URL** | `https://card-yeti-sync.fly.dev/api/ebay-callback` |
| **OAuth Decline URL** | `https://card-yeti-sync.fly.dev/app/ebay?error=oauth_denied` |
| **Notification Endpoint** | `https://card-yeti-sync.fly.dev/api/ebay-notifications` |

## Scripts

| Command | Description |
|:--------|:------------|
| `npm run dev` | Start dev server via Shopify CLI |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run setup` | Generate Prisma client + run migrations |
| `npm run test` | Run Vitest tests |
| `npm run dev:full` | Start Fly DB proxy + Shopify dev server |

---

<p align="center">
  Built for <a href="https://cardyeti.com">Card Yeti</a>
</p>
