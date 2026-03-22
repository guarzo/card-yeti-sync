<p align="center">
  <img src="../public/card-yeti-logo.png" alt="Card Yeti" width="300" />
</p>

<h2 align="center">Shopify Integration Proposal for Helix</h2>

<p align="center">
  <em>A public Shopify app that lets any Pokémon card seller sync their inventory to Helix automatically</em>
</p>

<p align="center">
  <a href="#the-idea">The Idea</a> &middot;
  <a href="#whats-already-built">What's Built</a> &middot;
  <a href="#proposed-api">Proposed API</a> &middot;
  <a href="#listing-schema">Schema</a> &middot;
  <a href="#phased-rollout">Rollout</a>
</p>

---

**Date:** March 2026

## The Idea

A public Shopify app that lets **any** Pokémon card seller sync their inventory to Helix automatically. Any TCG seller on Shopify installs the app, connects their Helix account, and starts listing. Helix gets access to the entire Shopify TCG seller ecosystem through a single integration.

> **One integration, unlimited sellers.** The app is public on the Shopify App Store, so every Pokémon card seller on Shopify becomes a potential Helix seller — no individual onboarding required.

---

## What's Already Built

I run a Pokémon card shop on Shopify ([Card Yeti](https://cardyeti.com)) and I've been building tooling to sync inventory across eBay, Shopify, and Whatnot. Here's the current state:

| Component | Status | Description |
|:----------|:-------|:------------|
| **Shopify App** | Active | Embedded admin app with priority-driven sync dashboard — at-a-glance marketplace health, sync activity, per-product listing status across all channels, and price suggestion review workflow |
| **eBay Integration** | Active | OAuth + Sell Inventory API with automatic policy assignment |
| **Whatnot Export** | CSV Ready | Bulk upload file generation with rich card descriptions |
| **19 Card Metafields** | Live in Production | Structured data per card across hundreds of products |
| **Cross-Channel Delist** | In Development | Auto-remove from other channels when a card sells |

The app uses an **adapter pattern** — each marketplace gets its own adapter behind a consistent interface. Adding Helix would follow the same pattern as the eBay adapter already in development.

<p align="center">
  <img src="dashboard.jpg" alt="Card Yeti Dashboard" width="800" />
</p>

### Structured Card Data

Every card in the Shopify store has 19 custom metafields under the `card` namespace. This goes far beyond title + photos:

<table>
<tr>
<td width="33%" valign="top">

**Card Identity**
- Pokémon name
- Set name
- Card number
- Language
- Year
- Rarity

</td>
<td width="33%" valign="top">

**Grading (slabs)**
- Grading company
- Grade
- Cert number + URL
- Population at grade
- Population higher
- Subgrades (BGS)

</td>
<td width="33%" valign="top">

**Condition & Commerce**
- Condition (NM, LP, etc.)
- Centering measurements
- Condition notes
- Market comp pricing
- Source tracking (eBay IDs)

</td>
</tr>
</table>

> This schema is live across hundreds of products. It maps 1:1 to the proposed Helix listing schema — zero data transformation gaps.

---

## Proposed API

Designed to be practical and incremental. Start with listing endpoints, add webhooks later.

### Authentication

OAuth 2.0 with API keys per seller. (Rails has great tooling for this via the Doorkeeper gem.)

```http
POST /api/v1/auth/token

{
  "grant_type": "authorization_code",
  "code": "<authorization_code>",
  "client_id": "<app_client_id>",
  "client_secret": "<app_client_secret>",
  "redirect_uri": "<callback_url>"
}
```

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 7200,
  "token_type": "Bearer"
}
```

### Endpoints

#### Listings

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/v1/listings` | Create a single listing |
| `POST` | `/api/v1/listings/bulk` | Create/update up to 50 listings |
| `GET` | `/api/v1/listings` | List seller's listings (paginated) |
| `GET` | `/api/v1/listings/:id` | Get listing details |
| `PUT` | `/api/v1/listings/:id` | Update a listing |
| `DELETE` | `/api/v1/listings/:id` | Delist / remove |

#### Inventory

| Method | Path | Description |
|:-------|:-----|:------------|
| `PUT` | `/api/v1/listings/:id/inventory` | Update availability (quantity, status) |
| `POST` | `/api/v1/inventory/bulk` | Bulk inventory update |

#### Orders (read-only for sellers)

| Method | Path | Description |
|:-------|:-----|:------------|
| `GET` | `/api/v1/orders` | List seller's orders (paginated) |
| `GET` | `/api/v1/orders/:id` | Order details |

#### Pricing Data

> Helix's real-time bid/ask market and AI-powered price forecasting are a massive differentiator. Exposing pricing data via the API could be a huge driver for seller adoption — sellers pulling Helix market data to price their inventory across **all** channels.

| Method | Path | Description |
|:-------|:-----|:------------|
| `GET` | `/api/v1/pricing/:card_identifier` | Current market data for a card |
| `GET` | `/api/v1/pricing/bulk` | Bulk pricing lookup (up to 50 cards) |

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

> **The flywheel:** Sellers use Helix pricing to set competitive prices everywhere, which builds Helix's brand as *the* pricing authority for Pokémon cards. Even sellers who don't list on Helix directly would be consuming Helix pricing data.

#### Webhooks

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/v1/webhooks` | Register a webhook URL |
| `GET` | `/api/v1/webhooks` | List registered webhooks |
| `DELETE` | `/api/v1/webhooks/:id` | Unregister |

#### Rate Limiting

100 requests/minute per seller. Rate limits can be adjusted based on usage patterns post-launch.

---

## Listing Schema

The `card` sub-object is where all the structured data lives — the data that powers Helix's search, filtering, and analytics far beyond what a plain title + photo listing provides.

### Graded card example

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

### Enums

<table>
<tr>
<td valign="top">

**Listing Types**

| Value | Description |
|:------|:------------|
| `fixed_price` | Standard buy-it-now |
| `bid_ask` | Real-time bid/ask market |
| `escrow_trade` | Middleman card-for-card trade |

</td>
<td valign="top">

**Condition Values**

| Value | Description |
|:------|:------------|
| `graded` | Professionally graded slab |
| `raw` | Ungraded single card |
| `sealed` | Factory-sealed product |

</td>
</tr>
</table>

---

## Field Mapping

How the Shopify metafields already live on the store map to the proposed schema — a 1:1 match with no data transformation gaps:

| Shopify Metafield (`card.*`) | Helix Field | Transform |
|:-----------------------------|:------------|:----------|
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
| `type_label` | `condition` enum | Maps "Graded Slab" to `graded`, etc. |
| `ebay_item_id` | `external_refs.ebay_item_id` | Direct |
| `ebay_comp` | *(available, not mapped)* | Could become `market_data.ebay_comp` |

---

## Webhook Events

### `order.created`

> This is the critical one. When a buyer purchases on Helix, Card Yeti needs to know immediately to delist from Shopify, eBay, and Whatnot. **Preventing double-sells is the entire point of cross-channel sync.**

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

### Webhook Delivery

| Property | Value |
|:---------|:------|
| **Transport** | HTTPS only |
| **Verification** | HMAC-SHA256 with shared secret |
| **Retries** | 3 attempts with exponential backoff |
| **Validation** | Challenge-response handshake for endpoint verification |

---

## Phased Rollout

<table>
<tr>
<td width="33%" valign="top">

### Phase 1: Bulk Import

**Helix builds:**
- `POST /api/v1/auth/token`
- `POST /api/v1/listings/bulk`
- `GET /api/v1/listings`

**Card Yeti builds:**
- Helix adapter (same pattern as eBay)
- Settings page: connect + configure
- One-click bulk sync

**Result:**
Sellers sync their Shopify inventory to Helix with one click.

</td>
<td width="33%" valign="top">

### Phase 2: Real-Time Sync

**Helix adds:**
- `PUT /api/v1/listings/:id`
- `DELETE /api/v1/listings/:id`
- `PUT .../inventory`

**Card Yeti adds:**
- Webhook-driven sync
- Auto-delist on inventory change

**Result:**
Hands-free ongoing sync. Changes in Shopify reflect on Helix automatically.

</td>
<td width="33%" valign="top">

### Phase 3: Bidirectional + Pricing

**Helix adds:**
- Webhook registration + events
- `GET /api/v1/orders`
- `GET /api/v1/pricing/*`

**Card Yeti adds:**
- Inbound webhook handler
- Price review workflow — Helix pricing data feeds suggested price updates directly into the dashboard, where sellers review and approve before syncing across all channels

**Result:**
Full bidirectional sync. Helix pricing data drives seller decisions across every marketplace — building Helix's brand as the pricing authority.

</td>
</tr>
</table>

---

## Why This Makes Sense

<table>
<tr>
<td width="50%" valign="top">

**For Helix**

- **Instant seller base** — Every Shopify Pokémon card seller is a potential Helix seller through one app install
- **Rich structured data** — 19 parsed card fields per listing, ready for search, filtering, and analytics
- **Pricing authority** — Sellers see Helix price suggestions directly in their dashboard and approve them across all channels, building Helix's brand as where prices are set

</td>
<td width="50%" valign="top">

**For Sellers**

- **Zero-friction onboarding** — Install app, connect, sync. Live on Helix in minutes
- **No double-sells** — Cross-channel delisting happens automatically
- **Better pricing** — Helix market data surfaces as price suggestions in the dashboard, reviewable and approvable before syncing to all channels
- **Lower fees** — 4.9% vs 12.9% on eBay

</td>
</tr>
</table>

---

## Technical Details

For anyone curious about the app side:

- **Framework:** React Router v7 (Shopify's recommended), deploying on Fly.io
- **Database:** Prisma + SQLite (dev) / PostgreSQL (prod) for multi-tenant data
- **Architecture:** Adapter pattern — each marketplace implements a consistent interface for listing, delisting, and inventory updates
- **Data model:** Supports multi-marketplace accounts, listing state tracking, sync audit logs, and a price suggestion review pipeline for approving pricing changes before they propagate
- **Field mappings:** 1:1 from existing Shopify metafield definitions — battle-tested across hundreds of live products
- **eBay integration:** OAuth + Sell API actively in development, proving the adapter pattern

---

<p align="center">
  <em>Questions or feedback? Let's build this.</em>
</p>
