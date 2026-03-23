<h2 align="center">Cross-Channel Sync & Pricing Tools — Proposal for Helix</h2>

<p align="center">
  <em>Multi-marketplace inventory sync and pricing automation for Helix sellers</em>
</p>

<p align="center">
  <a href="#the-idea">The Idea</a> &middot;
  <a href="#two-approaches">Two Approaches</a> &middot;
  <a href="#how-it-connects-to-the-roadmap">Roadmap Fit</a> &middot;
  <a href="#whats-already-built">What's Built</a> &middot;
  <a href="#proposed-api">Proposed API</a> &middot;
  <a href="#listing-schema">Schema</a> &middot;
  <a href="#phased-rollout">Rollout</a> &middot;
  <a href="OPTION_B_IMPLEMENTATION.md">Option B Implementation Guide</a>
</p>

---

**Date:** March 2026

**Note:** I'm open to write all the code for this — both the Helix platform side and the Shopify app side. This proposal is about what aligns with the Helix vision

## The Idea

Sellers today are spread across Shopify, eBay, Whatnot, and TCGPlayer. Managing inventory across all of them is painful — duplicate listings, double-sells, inconsistent pricing. This proposal is a cross-channel sync layer that connects Helix to those marketplaces, with two possible directions for the flow.

---

## Two Approaches

The big question: **which direction does the sync flow?**

<table>
<tr>
<td width="50%" valign="top">

### Option A: Shopify as On-Ramp

**Flow:** Shopify/eBay/Whatnot → Helix

Sellers who already have inventory on Shopify install an app, connect their Helix account, and their entire catalog is live on Helix in minutes. This is a **migration funnel** — meet sellers where they are, then pull them toward Helix Storefronts once they see the fees and the data.

**Good for:**
- Acquiring sellers who aren't on Helix yet
- Low-friction onboarding for the Shopify TCG ecosystem
- Getting inventory volume onto the marketplace quickly

**Risk:**
- Could be seen as reinforcing Shopify rather than replacing it

</td>
<td width="50%" valign="top">

### Option B: Helix as the Hub

**Flow:** Helix → Shopify/eBay/Whatnot

Helix Storefronts become the **source of truth** for a seller's inventory. The sync layer pushes listings out to Shopify, eBay, and Whatnot — and pulls them back when a card sells on any channel. Sellers manage everything from Helix and treat external marketplaces as distribution channels.

**Good for:**
- Aligns directly with Storefronts replacing Shopify
- Makes Helix the center of the seller's world
- Sticky — once your source of truth is on Helix, you don't leave
- Natural fit for the vendor management suite

**Risk:**
- Requires sellers to commit to Helix first

</td>
</tr>
</table>

> These aren't mutually exclusive. Option A gets sellers in the door, Option B keeps them. The adapter pattern I've built supports both directions — the sync layer doesn't care which end is the source of truth. **But if I had to pick one to build first, I'd want to hear which direction fits the Helix vision better.**

---

## How It Connects to the Roadmap

This feeds directly into the priorities you've outlined, regardless of which direction we go:

| Roadmap Priority | How This Helps |
|:-----------------|:---------------|
| **Bulk pricing tool** | The sync layer brings in (or pushes out) structured card data with 19 fields per card — set name, card number, grade, population, condition — giving the bulk pricing tool rich data to work with instead of just titles and photos |
| **Automated pricing adjustments** | I've already built a price suggestion review pipeline. Connecting it to Helix pricing data means sellers can pull market prices and auto-adjust across all channels within a configurable threshold. This makes Helix *the* pricing authority — sellers depend on it even if they still list elsewhere |
| **Vendor management suite** | Cross-channel inventory state, sync audit logs, and delist-on-sale logic are all part of what I've already built. With Option B especially, this becomes core vendor management infrastructure — the dashboard where sellers run their business |

I'm particularly motivated to help with the bulk pricing and automated adjustment tools — I need them for my own shop and I've already been building in that direction.

---

## What's Already Built

I run a Pokemon card shop on Shopify ([Card Yeti](https://cardyeti.com)) and I've been building tooling to sync inventory across marketplaces. Here's what exists today:

| Component | Status | Description |
|:----------|:-------|:------------|
| **Shopify App** | Active | Embedded admin app with sync dashboard — marketplace health, sync activity, per-product listing status, and price suggestion review workflow |
| **eBay Integration** | In Development | OAuth active, Sell Inventory API adapter + automatic policy assignment in progress |
| **Whatnot Export** | CSV Ready | Bulk upload file generation with rich card descriptions |
| **19 Card Metafields** | Live in Production | Structured data per card across hundreds of products |
| **Cross-Channel Delist** | In Development | Auto-remove from other channels when a card sells |

The app uses an **adapter pattern** — each marketplace gets its own adapter behind a consistent interface. The architecture is direction-agnostic: the same adapter handles pushing listings out and pulling data in. Adding Helix as a source or a destination follows the same pattern as the eBay adapter already in development.

<p align="center">
  <img src="dashboard.jpg" alt="Sync Dashboard" width="800" />
</p>

### Structured Card Data

Every card in the store has 19 custom metafields under the `card` namespace. This is the kind of rich structured data that powers search, filtering, and analytics:

<table>
<tr>
<td width="33%" valign="top">

**Card Identity**
- Pokemon name
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

> This schema is live across hundreds of products. It maps 1:1 to the proposed listing schema below — zero data transformation gaps.

---

## Proposed API

This is what a full seller API could look like. I'd build the implementation on the Helix side — this spec is a starting point for discussion, as I am sure you have your own data model already

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

> This is where it gets interesting for the roadmap. Helix's real-time bid/ask market and AI-powered price forecasting are a massive differentiator. Exposing pricing data via an API would let sellers pull Helix market prices to set competitive prices across **all** channels. This builds Helix's brand as the pricing authority, and it's the foundation for the automated pricing adjustment tool on the roadmap.

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

> **The flywheel:** Sellers use Helix pricing to set competitive prices everywhere, which builds Helix's brand as *the* pricing authority for Pokemon cards. Even sellers who don't list on Helix directly would be consuming Helix pricing data — and that's a monetization opportunity too (card hedger/pokemon price charge $99/month for similar data).

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

The `card` sub-object is where all the structured data lives — the data that powers search, filtering, and analytics far beyond what a plain title + photo listing provides.

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

How the Shopify metafields already in production map to the proposed schema — a 1:1 match with no data transformation gaps:

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

> The critical event. When a card sells on any channel, every other channel needs to know immediately to delist. **Preventing double-sells is the entire point of cross-channel sync.**

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

As mentioned, I'm open to writing all the code for this — both the Helix platform side (API endpoints, webhook system) and the Shopify app side (adapter, sync logic, dashboard). The phases below assume Option A (Shopify → Helix), but the same phases work in reverse for Option B.

<table>
<tr>
<td width="33%" valign="top">

### Phase 1: Bulk Import

**Helix platform work:**
- Auth endpoint (OAuth 2.0)
- Bulk listing create/update endpoint
- Listing query endpoint

**Shopify app work:**
- Helix adapter (same pattern as eBay)
- Settings page: connect + configure
- One-click bulk sync
- Field mapping + validation

**Result:**
Sellers sync their inventory to Helix with one click. Helix gets structured listings with rich card data immediately.

</td>
<td width="33%" valign="top">

### Phase 2: Real-Time Sync

**Helix platform work:**
- Listing update/delete endpoints
- Inventory update endpoints

**Shopify app work:**
- Webhook-driven sync from Shopify
- Auto-delist on inventory change
- Sync status monitoring

**Result:**
Hands-free ongoing sync. Changes propagate automatically between platforms.

</td>
<td width="33%" valign="top">

### Phase 3: Bidirectional + Pricing

**Helix platform work:**
- Webhook registration + event dispatch
- Order query endpoints
- Pricing data endpoints

**Shopify app work:**
- Inbound webhook handler for Helix sales
- Cross-channel delist on Helix purchase
- Price review workflow — Helix pricing data feeds suggested price updates into the dashboard, where sellers review and approve before syncing across all channels

**Result:**
Full bidirectional sync. Helix pricing data drives seller decisions across every marketplace. This is the foundation for the automated pricing tool on the roadmap.

</td>
</tr>
</table>

---

## Why This Makes Sense

<table>
<tr>
<td width="50%" valign="top">

**For Helix**

- **Seller acquisition** (Option A) — Every Shopify Pokemon card seller is a potential Helix seller through one app install
- **Platform stickiness** (Option B) — Sellers who manage everything from Helix don't leave. Storefronts + sync = the complete seller toolkit
- **Rich structured data** — 19 parsed card fields per listing, ready for search, filtering, and analytics
- **Pricing authority** — Sellers pull Helix market prices to set competitive prices across all channels, building Helix's brand as where prices are set
- **No bandwidth cost** — I write all the code, both sides

</td>
<td width="50%" valign="top">

**For Sellers**

- **One place to manage everything** — Whether that's Helix (Option B) or their existing Shopify store (Option A), inventory stays in sync everywhere
- **No double-sells** — Cross-channel delisting happens automatically when a card sells anywhere
- **Better pricing** — Helix market data surfaces as price suggestions, reviewable and approvable before syncing to all channels
- **Lower fees** — 4.9% vs 12.9% on eBay
- **Migration path** — Start wherever you are, move toward Helix at your own pace

</td>
</tr>
</table>

---

## Technical Details

For anyone curious about the existing app architecture:

- **Framework:** React Router v7 (Shopify's recommended), deploying on Fly.io
- **Database:** Prisma + SQLite (dev) / PostgreSQL (prod) for multi-tenant data
- **Architecture:** Adapter pattern — each marketplace implements a consistent interface for listing, delisting, and inventory updates. Direction-agnostic by design
- **Data model:** Supports multi-marketplace accounts, listing state tracking, sync audit logs, and a price suggestion review pipeline for approving pricing changes before they propagate
- **Field mappings:** 1:1 from existing Shopify metafield definitions — battle-tested across hundreds of live products
- **eBay integration:** OAuth + Sell API actively in development, proving the adapter pattern works

---

<p align="center">
  <em>Happy to adjust scope, start with whichever direction fits best, or pivot to wherever I can be most useful. This is a starting point for discussion.</em>
</p>
