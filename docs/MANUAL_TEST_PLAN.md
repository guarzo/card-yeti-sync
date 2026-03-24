# Manual Test Plan: Card Yeti Sync — Production Shopify Store

## Context

Card Yeti Sync has been deployed to the production Shopify store. This test plan validates the application's key features in a safe, controlled manner. Shadow mode is the first priority — it ensures all eBay write operations are intercepted and logged without touching live eBay listings. After confirming shadow mode, we walk through eBay connect, sync review, Whatnot/Helix exports, and product import.

---

## Pre-Requisites

- Access to the production Shopify admin
- Card Yeti Sync app installed and accessible from the Shopify admin sidebar
- An eBay seller account with API credentials configured (or ready to connect)
- At least a few active products in Shopify with card metafields (pokemon, set_name, grade, etc.)
- A sample eBay File Exchange CSV or a few eBay item IDs for import testing

---

## Test 1: Validate Shadow Mode is Active

**Goal:** Confirm that shadow mode is ON and eBay write operations are blocked before testing any sync features.

### Steps

1. **Open the eBay page**
   - Navigate to: Shopify Admin → Apps → Card Yeti Sync → eBay
   - **Expected:** Page loads without errors

2. **Check for Shadow Mode banner**
   - At the top of the eBay page, look for a **yellow warning banner** that reads:
     > **Shadow Mode Active**
     > eBay write operations are disabled. Card Yeti is logging what it would do and comparing against actual eBay state.
   - **Expected:** Banner is visible with yellow/warning tone

3. **Check the Shadow Mode toggle button**
   - Scroll to the Sync Settings section
   - Locate the shadow mode toggle button
   - **Expected:** Button reads **"Disable Shadow Mode"** (indicating it's currently ON)
   - **DO NOT** click it — we want to stay in shadow mode

4. **Verify shadow stats display** (if any sync activity has occurred)
   - If the banner shows action counts (e.g., "5 actions logged: 4 matches, 1 discrepancy"), note them
   - **Expected:** Stats are rendered correctly, no NaN or undefined values

5. **Check Connection stats**
   - In the Connection section, note the stat cards:
     - Active Listings count
     - Pending count (shadow-created listings show as "pending")
     - Delisted count
     - Errors count
     - Status badge (shows "Connected")
   - **Expected:** All values render as numbers or "0", Status shows a green "Connected" badge, no errors

### Pass Criteria
- Yellow "Shadow Mode Active" banner is visible
- Toggle button says "Disable Shadow Mode"
- No console errors or broken UI elements

---

## Test 2: eBay Account Connection

**Goal:** Verify the eBay OAuth connection flow works correctly.

### Steps (if not already connected)

1. **Initiate connection**
   - On the eBay page, click **"Connect eBay Account"**
   - **Expected:** Redirects to eBay's OAuth authorization page

2. **Authorize on eBay**
   - Log in to your eBay seller account and grant permissions
   - **Expected:** Redirects back to Card Yeti Sync with `?success=connected` parameter

3. **Verify success banner**
   - **Expected:** Green success banner: "eBay account connected successfully."

4. **Verify connection card updates**
   - Connection card should now show:
     - Active/Pending/Delisted/Error listing counts
     - Status badge showing "Connected"
   - **Expected:** All fields populated, no "Unknown" or error states

5. **Verify Business Policies** (scroll down)
   - The Business Policies section reads existing policies from your eBay seller account
   - If policies exist: dropdowns for Fulfillment, Payment, and Return policies are shown
   - If one or more policies are missing: a warning banner appears stating policies must be created in eBay Seller Hub
   - **Expected:** Policies are displayed if they exist on eBay, or warning banner is shown (no auto-creation occurs)

### Steps (if already connected)

1. **Verify connected state**
   - Connection card shows stats and a "Disconnect" button
   - Status badge shows "Connected"
   - **Expected:** Connected state is clear and stats render

### Pass Criteria
- eBay account shows as connected
- Business policies are visible
- Token expiry is displayed correctly

---

## Test 3: Shadow Mode — Trigger and Review Sync Activity

**Goal:** Trigger a product sync while in shadow mode and verify that no actual eBay writes occur, but shadow logs are captured.

### Steps

1. **Trigger a sync event** (choose one method):

   **Option A — Edit a product in Shopify:**
   - Go to Shopify Admin → Products → pick a product with card metafields
   - Make a minor edit (e.g., change description slightly) and save
   - This triggers the `webhooks.products.update` handler

   **Option B — Create a new product:**
   - Create a new product with appropriate tags/type that matches sync rules
   - This triggers the `webhooks.products.create` handler

2. **Wait ~10-30 seconds** for the webhook to process

3. **Return to Card Yeti Sync → eBay page**
   - **Expected:** Shadow Mode banner now shows updated action count

4. **Review Shadow Activity table**
   - Should appear below the Connection section (only visible when shadow mode is active AND there are logged actions)
   - Table columns: Action, Product, Result, Time
   - **Expected:**
     - Action shows the operation type (e.g., "list", "update")
     - Product shows the product ID
     - Result shows either a green **"Match"** badge or red **"Discrepancy"** badge
     - Time shows a recent timestamp

5. **Verify no actual eBay listing was created**
   - Check your eBay seller account — no new listing should appear
   - In the Connection stats, new shadow listings appear as **"Pending"** (not "Active")
   - **Expected:** No new active eBay listings; product tracked locally as "pending"

### Pass Criteria
- Shadow activity table populates with logged actions
- Match/Discrepancy badges render correctly
- No actual writes made to eBay (verify on eBay seller dashboard)
- Local listing status is "pending", not "active"

---

## Test 4: Export to Whatnot

**Goal:** Verify Whatnot CSV export generates a valid file with correct product data.

### Steps

1. **Navigate to Whatnot page**
   - Card Yeti Sync → Whatnot (sidebar navigation)
   - **Expected:** Page loads with CSV Export section, stat cards, and export buttons

2. **Check stat cards**
   - "Exportable Products" — shows count of graded cards
   - "Last Export" — shows date of last export or "Never"
   - "Format" — shows format info
   - **Expected:** Values render correctly

3. **Click "Export All Products"**
   - **Expected:** Browser downloads a CSV file named `whatnot-export-YYYY-MM-DD.csv`

4. **Open and validate the CSV**
   - Check headers match expected 21 columns:
     ```csv
     Category, Sub Category, Title, Description, Quantity, Type, Price,
     Shipping Profile, Offerable, Hazmat, Condition, Cost Per Item, SKU,
     Image URL 1, Image URL 2, ..., Image URL 8
     ```
   - Verify sample rows:
     - **Category** = "Trading Card Games"
     - **Sub Category** = "Pokémon Cards"
     - **Title** matches Shopify product title
     - **Description** includes Pokémon name, set, grade, cert number
     - **Price** is a whole dollar amount (rounded up from compareAtPrice)
     - **Shipping Profile** is one of: "4-8 oz", "0-1 oz", "9 oz-1 lb"
     - **Condition** = "Graded" for graded cards
     - **SKU** matches Shopify variant SKU
     - **Image URLs** are valid Shopify CDN URLs
   - **Expected:** All columns populated correctly, no empty required fields

5. **Test "Export New Only"** (if prior export exists)
   - Click "Export New Only"
   - **Expected:** CSV contains only products not in a previous export, or is empty if all were already exported

6. **Check stat cards updated**
   - "Last Export" should now show the current date/time
   - **Expected:** Timestamp updated

### Pass Criteria
- CSV downloads successfully
- Headers and data format match Whatnot's expected schema
- Product data (title, price, images, metafields) maps correctly
- "Export New Only" filters appropriately

---

## Test 5: Export to Helix

**Goal:** Verify Helix CSV export generates a valid file with rich card metadata.

### Steps

1. **Navigate to Helix page**
   - Card Yeti Sync → Helix (sidebar navigation)
   - **Expected:** Page loads with Export section, stat cards (Exportable Products, Last Export), and export buttons

2. **Check page elements**
   - Exportable Products shows count of graded cards
   - Last Export shows date or "Never"
   - **Expected:** Values render correctly

3. **Click "Export All Products"**
   - **Expected:** Browser downloads `helix-export-YYYY-MM-DD.csv`

4. **Open and validate the CSV**
   - Check headers match the 14-column TCGPlayer-style format:
     ```csv
     TCGplayer Id, Product Line, Set Name, Product Name, Title, Number,
     Rarity, Condition, TCG Market Price, TCG Direct Low,
     TCG Low Price With Shipping, TCG Marketplace Price,
     Add to Quantity, Total Quantity
     ```
   - Verify sample rows:
     - **TCGplayer Id** = Shopify numeric product ID (used for cross-referencing)
     - **Product Line** = "Pokemon"
     - **Set Name** and **Product Name** populated from card metafields
     - **Title** = descriptive title built from pokemon, set, number, and grade
     - **Condition** = TCG condition mapped from grade (Near Mint / Lightly Played / etc.)
     - **TCG Market Price** and **TCG Marketplace Price** = dollar amount (e.g., "49.99")
     - **Add to Quantity** and **Total Quantity** = actual inventory count
   - **Expected:** All 14 columns present, card metadata populated correctly

5. **Test "Export New Only"**
   - Click "Export New Only"
   - **Expected:** Filters to only un-exported products (products not in a previous export)

### Pass Criteria
- CSV downloads successfully
- 14-column TCGPlayer-style format with prices in dollars
- Card metadata (set name, number, rarity, condition) populated from metafields
- TCGplayer Id column contains Shopify product IDs for cross-referencing

---

## Test 6: Import Products (Shadow Mode Safe)

**Goal:** Verify the import flow creates Shopify products correctly. Import writes to Shopify (not eBay), so it's safe to test even with shadow mode active. Shadow mode only blocks eBay writes.

### Important Note
Import creates **real Shopify products**. If you want to avoid creating products in production, you can:
- Run through the parse + review steps only (stop before clicking "Create")
- Or create a small test batch (1-2 items) and delete them after

### Method A: CSV Import

1. **Navigate to Import page**
   - Card Yeti Sync → Import (sidebar navigation)
   - **Expected:** Page loads with file upload area and eBay item ID input

2. **Upload an eBay File Exchange CSV**
   - Select or drag-and-drop a CSV file
   - Click submit / parse
   - **Expected:** Parser runs and shows review table

3. **Review the parsed results**
   - The ImportReviewTable should display:
     - Title, Pokemon, Set, Grade, Price columns
     - Original price (from CSV), API suggested price (if pricing API configured), Final price
     - Duplicate status (whether product already exists in Shopify)
     - Selection checkboxes
   - **Expected:** Cards parsed correctly, duplicates flagged, prices shown

4. **Validate parse stats**
   - Total rows parsed, skipped rows, any errors
   - **Expected:** Numbers make sense relative to the CSV file

5. **(Optional) Create products**
   - Select 1-2 test items and click Create
   - **Expected:** Products created in Shopify with:
     - Card metafields (pokemon, set_name, number, grade, cert_number, etc.)
     - Images from the CSV/eBay
     - Prices set correctly
   - Verify in Shopify Admin → Products that the new products appear with metafields

### Method B: eBay Item ID Import

1. **Enter eBay item IDs**
   - Paste 1-3 eBay item IDs (comma or newline separated)
   - Click submit / fetch
   - **Expected:** Items fetched via eBay Browse API, review table populates

2. **Review fetched items**
   - Same review table as CSV import
   - Card data extracted from eBay item specifics
   - **Expected:** Title, grade, price, images populated correctly

3. **(Optional) Create products**
   - Same as CSV flow above

### Pass Criteria
- CSV parsing extracts card data correctly
- eBay item ID fetch returns valid card data
- Review table renders with correct columns and data
- Duplicate detection works (flags existing products)
- Product creation (if tested) produces correct Shopify products with metafields

---

## Test 7: Dashboard Validation

**Goal:** Verify the main dashboard renders correctly with production data.

### Steps

1. **Navigate to Dashboard**
   - Card Yeti Sync → Dashboard (home page)
   - **Expected:** Page loads with marketplace tiles, sync summary, and products table

2. **Check Marketplace Tiles**
   - Each connected marketplace shows a tile with listing counts
   - **Expected:** eBay tile shows counts matching the eBay page stats

3. **Check Sync Summary**
   - Recent sync activity log
   - **Expected:** Shows recent operations (including shadow operations if any)

4. **Check Attention Zone**
   - If there are errors or items needing attention, they appear here
   - **Expected:** Renders correctly or shows empty state

5. **Check Products Sync Table**
   - Lists products with their sync status per marketplace
   - **Expected:** Products display with correct status badges

### Pass Criteria
- Dashboard loads without errors
- All sections render with real data
- Marketplace stats are consistent with individual marketplace pages

---

## Post-Test Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | Shadow mode confirmed active (yellow banner visible) | |
| 2 | Shadow mode toggle says "Disable Shadow Mode" | |
| 3 | eBay account connected (or connection flow works) | |
| 4 | Business policies displayed | |
| 5 | Shadow activity logs captured after product edit/create | |
| 6 | No actual eBay listings created (verified on eBay) | |
| 7 | Whatnot CSV exports with correct 21-column format | |
| 8 | Helix CSV exports with correct 14-column TCGPlayer format (prices in dollars) | |
| 9 | Import CSV parse works and review table displays | |
| 10 | Import eBay item ID fetch works | |
| 11 | Dashboard renders correctly with production data | |
| 12 | No console errors or broken UI across all pages | |

---

## Notes

- **Shadow mode only blocks eBay writes.** Whatnot/Helix CSV exports and Shopify product imports are unaffected by shadow mode — they are safe to run.
- **Exports are CSV downloads** — they don't push data to Whatnot or Helix directly. The CSV files are uploaded manually to those platforms.
- **Import creates real Shopify products** — use caution in production. Parse + review steps are safe; product creation is the commitment point.
- **Shadow logs persist in the SyncLog table** — you can query them later for analysis of match rates before disabling shadow mode.
