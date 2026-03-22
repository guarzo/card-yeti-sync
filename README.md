# Card Yeti Sync

Marketplace sync app for Pokemon card sellers on Shopify. Syncs products from Shopify to eBay, Whatnot, and Helix with automatic inventory management across channels.

## What It Does

- **eBay**: Direct integration via Sell API with automatic business policy assignment (shipping, payment, returns). Solves the Marketplace Connect limitation where new listings have no policies attached.
- **Whatnot**: CSV export (API integration planned when Seller API opens). Generates Whatnot-compatible bulk upload files with rich descriptions from card metafields.
- **Helix**: Integration with the new Pokemon card marketplace (API in development). Structured data sync with full card metadata.
- **Cross-channel inventory**: When a card sells on any channel, it's automatically delisted everywhere else. Periodic reconciliation catches drift.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Router v7 |
| UI | Polaris web components (embedded in Shopify admin) |
| Database | Prisma + SQLite (dev) / Postgres (prod) |
| Hosting | Fly.io |
| Auth | Shopify managed installation + token exchange |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.19
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- A Shopify Partner account and dev store

## Setup

```bash
npm install
npx prisma migrate dev
```

## Development

```bash
shopify app dev
```

This starts the dev server, creates a tunnel, and opens the app in your Shopify admin. Press `p` to open the app URL.

## Project Structure

```
app/
  routes/
    app._index.tsx              # Dashboard — product overview, sync status
    app.ebay.tsx                # eBay settings — connect account, configure policies
    app.whatnot.tsx              # Whatnot settings — CSV export
    app.helix.tsx               # Helix settings — connect account
    webhooks.products.*.tsx     # Product create/update handlers
    webhooks.orders.create.tsx  # Cross-channel delist on sale
    webhooks.inventory.*.tsx    # Inventory change propagation
  lib/
    adapters/                   # Marketplace adapters (eBay, Whatnot, Helix)
    mappers/                    # Shopify → marketplace data transforms
  db.server.ts                  # Prisma client
  shopify.server.ts             # Shopify app config

prisma/
  schema.prisma                 # Session, MarketplaceAccount, MarketplaceListing, SyncLog

docs/
  HELIX_PROPOSAL.md             # Integration proposal for Helix
  PRD.md                        # Product requirements document
```

## Data Model

The app tracks marketplace connections and listing state per shop:

- **MarketplaceAccount** — OAuth tokens and settings for each marketplace connection
- **MarketplaceListing** — Tracks each product's listing ID, status, and last sync per marketplace
- **SyncLog** — Audit trail of all sync operations

Products in Shopify use custom metafields under the `card` namespace (19 fields covering card identity, grading, condition, and commerce data). These are mapped to each marketplace's native format by the adapter layer.

## Deployment

```bash
npm run build
fly deploy
```

See [Shopify deployment docs](https://shopify.dev/docs/apps/launch/deployment) and [Fly.io Shopify guide](https://fly.io/docs/js/shopify/) for details.

## Environment Variables

Set by Shopify CLI during development. For production, configure on Fly.io:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `NODE_ENV=production`
