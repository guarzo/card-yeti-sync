# Shopify Integration for Helix

**Date:** March 2026

---

## Hey team!

The basic idea: **a public Shopify app that lets any Pokemon card seller sync their inventory to Helix automatically.** Any TCG seller on Shopify could install the app, connect their Helix account, and start listing. Helix gets access to the whole Shopify TCG seller ecosystem through a single integration.

---

## What I've Already Built

I run a Pokemon card shop on Shopify (Card Yeti) and I've been syncing inventory across eBay, Shopify, and Whatnot manually using CLI scripts I wrote. It works, but it's a manual process — I'm currently building a Shopify app to automate all of it. Here's what exists today:

- **CLI-based eBay imports** — a Node script that pulls from eBay's API, parses item specifics, and creates structured Shopify products
- **19 custom Shopify metafields** per card — structured data for card identity, grading, condition, and commerce (this is live on my store today)
- **CLI-based Whatnot CSV export** — generates bulk upload files with rich descriptions from Shopify product data
- **Manual cross-channel delisting** — when a card sells, I delist from other channels by hand (automating this is a key goal of the Shopify app)

The Shopify app I'm building will automate all of this with an adapter pattern — each marketplace gets its own adapter behind a consistent interface, so adding Helix would be straightforward. The eBay integration is actively in development.

The data model I'm already using captures way more than what most sellers provide. Instead of just a title and photos, every card has:

**Card identity:**
- Pokemon name, set, card number, language, year, rarity

**Grading (for slabs):**
- Grading company (PSA, CGC, BGS, SGC, TAG, etc.)
- Grade, cert number, cert verification URL
- Population at grade, population higher
- Subgrades (BGS Centering/Edges/Surface/Corners)

**Condition (for raw cards):**
- Condition (Near Mint, Lightly Played, etc.)
- Centering measurements
- Detailed condition notes

**Commerce:**
- Market comparable pricing (eBay comps)
- Source tracking (eBay item IDs, SKUs)

This schema is live on my Shopify store across hundreds of products. I think this structured data would be really valuable for Helix's search, filtering, and analytics — and can share the schema as a starting point for whatever seller API we design.

---

## How I Think the API Could Work

I think the stack is Next.js + Rails on Vercel, so I tried to keep this proposal practical — stuff that's simple to build incrementally. Start with listing endpoints, add webhooks later. Totally open to feedback on all of this.

### Authentication

OAuth 2.0 with API keys per seller. Rails has great tooling for this (Doorkeeper gem).

```
POST /api/v1/auth/token
{
  "grant_type": "authorization_code",
  "code": "<authorization_code>",
  "client_id": "<app_client_id>",
  "client_secret": "<app_client_secret>",
  "redirect_uri": "<callback_url>"
}

Response:
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 7200,
  "token_type": "Bearer"
}
```

### Endpoints

#### Listings

```
POST   /api/v1/listings              Create a single listing
POST   /api/v1/listings/bulk         Create/update up to 50 listings
GET    /api/v1/listings              List seller's listings (paginated)
GET    /api/v1/listings/:id          Get listing details
PUT    /api/v1/listings/:id          Update a listing
DELETE /api/v1/listings/:id          Delist / remove
```

#### Inventory

```
PUT    /api/v1/listings/:id/inventory    Update availability (quantity, status)
POST   /api/v1/inventory/bulk            Bulk inventory update
```

#### Orders (read-only for sellers)

```
GET    /api/v1/orders                    List seller's orders (paginated)
GET    /api/v1/orders/:id                Order details
```

#### Pricing Data

 Helix's real-time bid/ask market and AI-powered price forecasting are such a huge differentiator — I think exposing pricing data via the API could be a massive driver for seller adoption. Imagine sellers pulling Helix market data to price their inventory across *all* their channels.

```
GET    /api/v1/pricing/:card_identifier  Get current market data for a card
GET    /api/v1/pricing/bulk              Bulk pricing lookup (up to 50 cards)
```

Response:
```json
{
  "card_identifier": "base-set-4-psa-9",
  "current_bid": 85000,
  "current_ask": 92500,
  "last_sale": 88000,
  "last_sale_date": "2026-03-18T12:00:00Z",
  "avg_30d": 87500,
  "trend": "stable",
  "volume_30d": 12
}
```

The feedback loop here is really cool: sellers use Helix's pricing to set competitive prices everywhere, which builds Helix's brand as *the* pricing authority for Pokemon cards. Even sellers who don't list on Helix directly would be consuming Helix pricing data.

#### Webhooks

```
POST   /api/v1/webhooks                 Register a webhook URL
GET    /api/v1/webhooks                 List registered webhooks
DELETE /api/v1/webhooks/:id             Unregister
```

### Rate Limiting

100 requests/minute per seller feels right for launch. We can always tighten it later based on what we see.

---

## Listing Data Schema

Here's what I'm thinking for the listing object shape. The `card` sub-object is where all the structured data lives — the stuff that makes Helix's search, filtering, and analytics way better than what you get from a plain title + photo listing.

```json
{
  "listing": {
    "title": "Charizard Holo - Base Set #4/102 PSA 9",
    "description": "Beautiful holo bleed. Clean corners, sharp edges.",
    "price_cents": 89900,
    "listing_type": "fixed_price",
    "condition": "graded",
    "quantity": 1,
    "images": [
      "https://example.com/front.jpg",
      "https://example.com/back.jpg"
    ],

    "card": {
      "pokemon": "Charizard",
      "set_name": "Base Set",
      "card_number": "4/102",
      "language": "English",
      "year": 1999,
      "rarity": "Holo Rare",

      "grading": {
        "company": "PSA",
        "grade": "9",
        "cert_number": "12345678",
        "cert_url": "https://www.psacard.com/cert/12345678",
        "population": 1234,
        "pop_higher": 567,
        "subgrades": null
      },

      "raw_condition": null
    },

    "external_refs": {
      "shopify_product_id": "gid://shopify/Product/123456789",
      "ebay_item_id": "325678901234",
      "source_sku": "PSA-12345678"
    }
  }
}
```

### Raw card example

For ungraded singles, `grading` is null and `raw_condition` gets populated:

```json
{
  "card": {
    "pokemon": "Umbreon",
    "set_name": "Neo Discovery",
    "card_number": "32/75",
    "language": "English",
    "year": 2001,
    "rarity": "Rare",
    "grading": null,
    "raw_condition": {
      "condition": "Near Mint",
      "centering": "55/45 LR",
      "notes": "Light whitening on back bottom edge"
    }
  }
}
```

### Listing types

| Type | Description |
|------|-------------|
| `fixed_price` | Standard buy-it-now listing |
| `bid_ask` | Real-time bid/ask market (Helix's signature feature) |
| `escrow_trade` | Middleman card-for-card trade |

### Condition values

| Value | Description |
|-------|-------------|
| `graded` | Professionally graded slab (PSA, CGC, BGS, SGC, TAG, etc.) |
| `raw` | Ungraded single card |
| `sealed` | Factory-sealed product (boxes, ETBs, packs) |

---

## Field Mapping

Here's how the Shopify metafields I already use on my store map to the proposed schema — basically a 1:1 match, which means no data transformation gaps:

| Shopify Metafield (`card.*`) | Helix Field | Notes |
|---|---|---|
| `pokemon` | `card.pokemon` | Direct |
| `set_name` | `card.set_name` | Direct |
| `number` | `card.card_number` | Direct |
| `language` | `card.language` | Direct |
| `year` | `card.year` | String to integer |
| `rarity` | `card.rarity` | Direct |
| `grading_company` | `card.grading.company` | Direct |
| `grade` | `card.grading.grade` | Direct |
| `cert_number` | `card.grading.cert_number` | Direct |
| `cert_url` | `card.grading.cert_url` | Auto-generated from company + cert |
| `population` | `card.grading.population` | Direct |
| `pop_higher` | `card.grading.pop_higher` | Direct |
| `subgrades` | `card.grading.subgrades` | Parse from string format |
| `condition` | `card.raw_condition.condition` | Raw cards only |
| `centering` | `card.raw_condition.centering` | Direct |
| `condition_notes` | `card.raw_condition.notes` | Direct |
| `type_label` | `condition` enum | Maps "Graded Slab" to "graded", etc. |
| `ebay_item_id` | `external_refs.ebay_item_id` | Cross-reference |
| `ebay_comp` | *(not listed, but available)* | Could become `market_data.ebay_comp` |

---

## Webhook Events

Once we're ready for real-time notifications, here's what I think we'd need:

### `order.created`

This is the big one. When a buyer purchases a listing on Helix, I need to know immediately so I can delist that card from Shopify, eBay, and Whatnot. Preventing double-sells is the whole point of cross-channel sync.

```json
{
  "event": "order.created",
  "data": {
    "order_id": "ord_abc123",
    "listing_id": "lst_xyz789",
    "buyer_id": "usr_...",
    "price_cents": 89900,
    "created_at": "2026-03-21T15:30:00Z"
  }
}
```

### `listing.status_changed`

For when a listing is approved, rejected, expired, or sold through other means.

```json
{
  "event": "listing.status_changed",
  "data": {
    "listing_id": "lst_xyz789",
    "old_status": "active",
    "new_status": "sold",
    "reason": "buyer_purchase",
    "changed_at": "2026-03-21T15:30:00Z"
  }
}
```

### Webhook delivery

- HTTPS endpoints only
- Signature verification (HMAC-SHA256 with shared secret)
- Retry on failure: 3 attempts with exponential backoff
- Challenge-response handshake for endpoint verification

---

## How We Could Phase This

### Phase 1: Bulk Import

**Helix side:**
- `POST /api/v1/auth/token` (OAuth)
- `POST /api/v1/listings/bulk` (bulk create)
- `GET /api/v1/listings` (list seller's listings)

**Shopify app (my side):**
- Helix adapter in the sync app (same pattern as the eBay adapter I'm building now)
- Settings page: connect Helix account, configure sync rules
- Bulk sync: push all active inventory to Helix

**Result:** Sellers can sync their Shopify inventory to Helix with one click.

### Phase 2: Real-Time Sync

**Helix side adds:**
- `PUT /api/v1/listings/:id` (update)
- `DELETE /api/v1/listings/:id` (delist)
- `PUT /api/v1/listings/:id/inventory` (inventory update)

**Shopify app adds:**
- Webhook-driven sync: product changes in Shopify auto-update on Helix
- Inventory sync: sold items auto-delist from Helix

**Result:** Hands-free ongoing sync. Changes in Shopify reflect on Helix automatically.

### Phase 3: Bidirectional + Pricing

**Helix side adds:**
- `POST /api/v1/webhooks` (webhook registration)
- `order.created` and `listing.status_changed` webhook events
- `GET /api/v1/orders` (order details)
- `GET /api/v1/pricing/:card_identifier` (market data)
- `GET /api/v1/pricing/bulk` (bulk pricing lookup)

**Shopify app adds:**
- Inbound webhook handler: Helix sales trigger cross-channel delisting
- Order visibility in the app's dashboard
- **Price intelligence**: Pull Helix market data to show sellers current bid/ask, recent sales, and 30-day trends. Optionally auto-suggest price adjustments across all channels.

**Result:** Full bidirectional sync plus pricing intelligence. Helix becomes the pricing engine sellers rely on everywhere.

---

## Why This Is a Good Fit

I don't want to oversell this — just laying out why I think it makes sense:

1. **It's an ecosystem play.** The Shopify app will be public, so it's not just my store. Any Pokemon card seller on Shopify could connect to Helix through it. One integration, unlimited sellers.

2. **The data is already structured.** Most sellers list with a title and photos. This integration delivers fully parsed card metadata — pokemon, set, number, grade, cert, population, condition — ready for Helix's search and analytics. No data entry required on the seller's part.

3. **Pricing authority.** If we expose Helix's pricing data through the API, every seller using the sync app becomes a Helix pricing data consumer — even across other channels. That positions Helix as where prices are set.

4. **Easy onboarding for new sellers.** Any Helix seller with a Shopify store can be live in minutes: install the app, connect, sync.

---

## Technical Details

For anyone curious about the Shopify app side:

- Built with React Router v7 (Shopify's recommended framework), deploying on Fly.io
- Prisma + SQLite (dev) / Postgres (prod) for multi-tenant data storage
- Database schema already supports multi-marketplace accounts, listing tracking, and sync logging
- eBay OAuth integration is in development now; marketplace adapters follow a consistent interface so adding Helix is the same pattern
- The listing schema maps directly from existing Shopify metafield definitions, so there are no data transformation gaps
- I've been running the manual CLI version of this workflow for a while, so the data model and field mappings are battle-tested even though the app itself is new

---

