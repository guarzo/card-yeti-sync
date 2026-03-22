# Helix Integration Proposal

**From:** Card Yeti (card-yeti.myshopify.com)
**Date:** March 2026
**Subject:** Shopify-to-Helix Marketplace Sync

---

## Executive Summary

We are building a **public Shopify app** that syncs inventory from Shopify stores to external marketplaces. Our first integration is with eBay, and we want Helix to be our second.

This isn't a single-store tool. Any Pokemon card seller on Shopify would be able to install the app, connect their Helix account, and sync their inventory automatically. Helix gets access to the entire Shopify TCG seller ecosystem through a single integration partnership.

We're proposing a lightweight REST API that Helix can build incrementally, starting with a bulk import endpoint and expanding to real-time webhooks. We've already solved the hard part — normalizing card data across eBay, Shopify, and Whatnot — and we're offering that data schema as a foundation for Helix's seller API.

---

## What We Bring

### A Public Shopify App

Our app installs on any Shopify store and syncs products to connected marketplaces. Each seller manages their own connections. For Helix, this means:

- **Zero onboarding friction** for new sellers: "Install the app, connect Helix, sync your inventory"
- **Ongoing inventory sync**: When a card sells on any channel (Shopify, eBay, Whatnot), it's automatically delisted from Helix. When new inventory is added to Shopify, it appears on Helix.
- **Rich, structured data**: Not just title and price — full card metadata (set, number, grade, cert, population, condition, centering, and more)

### A Battle-Tested Data Model

We've been importing and normalizing Pokemon card data across eBay and Shopify for months. Our data model captures 19 structured fields per card — far richer than what any current marketplace stores natively:

**Core card identity:**
- Pokemon name, set, card number, language, year, rarity

**Grading (graded cards):**
- Grading company (PSA, CGC, BGS, SGC, TAG, etc.)
- Grade, certification number, cert verification URL
- Population at grade, population higher
- Subgrades (BGS Centering/Edges/Surface/Corners)

**Condition (raw cards):**
- Condition (Near Mint, Lightly Played, etc.)
- Centering measurements
- Detailed condition notes

**Commerce:**
- Market comparable pricing (eBay comps)
- Source tracking (eBay item IDs, SKUs)

This data model has been validated across hundreds of products imported from eBay File Exchange CSVs, eBay Browse API item specifics, and manual data entry.

---

## Proposed API

We're proposing a REST API that fits Helix's existing tech stack (Next.js + Rails on Vercel). This is designed to be simple to build incrementally — start with the listing endpoints, add webhooks later.

### Authentication

OAuth 2.0 with API keys per seller. Rails has excellent tooling for this (Doorkeeper gem).

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

Helix's real-time bid/ask market and AI-powered price forecasting are a key differentiator. Exposing pricing data via the API would be hugely valuable to sellers — and would drive seller adoption of the platform.

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

This opens up a powerful feedback loop: sellers use Helix's pricing data to set competitive prices across all their channels (Shopify, eBay, Whatnot), which drives more informed pricing across the market and positions Helix as the pricing authority for Pokemon cards.

#### Webhooks

```
POST   /api/v1/webhooks                 Register a webhook URL
GET    /api/v1/webhooks                 List registered webhooks
DELETE /api/v1/webhooks/:id             Unregister
```

### Rate Limiting

100 requests/minute per seller. Generous for launch — can tighten later based on usage patterns.

---

## Listing Data Schema

This is the proposed shape of a listing object. The `card` sub-object captures the structured data that makes Helix's search, filtering, and analytics possible.

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

For ungraded singles, the `grading` field is null and `raw_condition` is populated:

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

How our Shopify metafields map to the proposed Helix schema:

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

When Helix is ready to push real-time notifications:

### `order.created`

Fires when a buyer purchases a listing. This is the most important webhook — it triggers immediate cross-channel delisting so the same card isn't sold twice.

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

Fires when a listing is approved, rejected, expired, or sold through other means.

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

## Phased Rollout

### Phase 1: Bulk Import (Weeks 1-2)

Helix builds:
- `POST /api/v1/auth/token` (OAuth)
- `POST /api/v1/listings/bulk` (bulk create)
- `GET /api/v1/listings` (list seller's listings)

We build:
- Helix adapter in our Shopify app
- Settings page: connect Helix account, configure sync rules
- Bulk sync: push all active inventory to Helix

**Result:** Sellers can sync their Shopify inventory to Helix with one click.

### Phase 2: Real-Time Sync (Weeks 3-4)

Helix adds:
- `PUT /api/v1/listings/:id` (update)
- `DELETE /api/v1/listings/:id` (delist)
- `PUT /api/v1/listings/:id/inventory` (inventory update)

We add:
- Webhook-driven sync: product changes in Shopify auto-update on Helix
- Inventory sync: sold items auto-delist from Helix

**Result:** Hands-free ongoing sync. Changes in Shopify reflect on Helix automatically.

### Phase 3: Bidirectional + Pricing (Weeks 5-8)

Helix adds:
- `POST /api/v1/webhooks` (webhook registration)
- `order.created` and `listing.status_changed` webhook events
- `GET /api/v1/orders` (order details)
- `GET /api/v1/pricing/:card_identifier` (market data)
- `GET /api/v1/pricing/bulk` (bulk pricing lookup)

We add:
- Inbound webhook handler: Helix sales trigger cross-channel delisting
- Order visibility in our app's dashboard
- **Price intelligence**: Pull Helix market data to show sellers current bid/ask, recent sales, and 30-day trends for their inventory. Optionally auto-suggest price adjustments across all channels.

**Result:** Full bidirectional sync plus pricing intelligence. Helix becomes the pricing engine that sellers rely on across all their channels.

---

## What Helix Gets

1. **An ecosystem, not a single seller.** Our public Shopify app gives Helix access to every Pokemon card seller on Shopify. One integration, unlimited sellers.

2. **Rich structured data.** Most sellers list with just a title and photos. Our data model delivers fully parsed card metadata — pokemon, set, number, grade, cert, population, condition — ready for Helix's search, filtering, and analytics features.

3. **A pricing authority play.** By exposing pricing data through the API, Helix becomes the source of truth for Pokemon card market pricing. Our app would pull Helix's bid/ask data and market trends to help sellers price their inventory across all channels. Every seller using the app becomes a Helix pricing data consumer — even if they don't list there directly. This builds Helix's brand as the place where prices are set.

4. **API validation before public launch.** We'll be the first external integration testing against the API as it's built. We'll catch edge cases, report issues, and help refine the design before it's opened to other developers.

5. **A ready-made seller onboarding path.** New Helix sellers who already have a Shopify store can be live in minutes: install the app, connect their account, sync their inventory.

## What We're Looking For

1. **Early API access** — we'll build against endpoints as they're developed
2. **Input on the API design** — the schema above is a proposal, not a demand. We want to collaborate on getting it right.
3. **Launch partner placement** — visibility as a featured integration when the API goes public
4. **A direct line** — a shared Slack channel or similar for rapid iteration during development

---

## About Card Yeti

Card Yeti is a Shopify-based Pokemon card store specializing in graded slabs, raw singles, and curated lots. We've built comprehensive tooling for card data management:

- Automated import from eBay (API + CSV) with full item specifics parsing
- 19 custom metafields for structured card data
- Price management with market comp tracking
- Export to Whatnot (CSV bulk upload)
- Inventory lifecycle automation (auto-draft OOS, auto-reactivate restocked)

Our marketplace sync app is the natural evolution of this tooling — taking what we built for one store and making it available to every TCG seller on Shopify.

---

## Technical Notes

- Our app is built with React Router v7 (Shopify's recommended framework) and deployed on Fly.io
- We use Prisma + SQLite/Postgres for multi-tenant data storage
- We receive Shopify webhooks for real-time product/order/inventory changes
- All marketplace adapters follow a consistent interface, making it straightforward to add Helix alongside eBay and Whatnot
- The listing data schema above maps directly from our existing Shopify metafield definitions — no data transformation gaps

## Contact

We're ready to start building as soon as API access is available. For Phase 1, all we need is the bulk listings endpoint and OAuth.

Let's set up a call to discuss timeline and next steps.
