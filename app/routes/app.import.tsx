import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { isPricingApiConfigured, fetchPriceBatch } from "../lib/pricing-api.server";
import { parseEbayFileExchangeCSV } from "../lib/import/csv-parser.server";
import { checkDuplicates } from "../lib/import/dedup.server";
import {
  fetchStoreData,
  createProduct,
  removeNewArrivalTags,
  DELAY_MS,
} from "../lib/import/product-builder.server";
import { sleep } from "../lib/timing";
import { ImportReviewTable } from "../components/import/ImportReviewTable";
import type {
  ParsedCard,
  ParseResponse,
  CreateResponse,
  ImportResult,
} from "../lib/import/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enrichWithPricing(cards: ParsedCard[]): Promise<boolean> {
  if (!isPricingApiConfigured()) return false;

  const certNumbers = cards
    .filter((c) => c.isGraded && c.certNumber)
    .map((c) => c.certNumber);

  if (certNumbers.length === 0) return false;

  try {
    const priceData = await fetchPriceBatch(certNumbers);
    const priceMap = new Map(
      priceData.results.map((r) => [r.certNumber, r.suggestedPrice]),
    );

    for (const card of cards) {
      if (card.certNumber && priceMap.has(card.certNumber)) {
        const apiPrice = priceMap.get(card.certNumber)!;
        card.apiSuggestedPrice = apiPrice;
        card.finalPrice = apiPrice;
      }
    }
    return true;
  } catch (err) {
    console.error(
      "Pricing API failed during import:",
      err instanceof Error ? err.message : err,
    );
    // Non-fatal: fall back to eBay prices
    return false;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface LoaderData {
  pricingApiConfigured: boolean;
}

type Step = "input" | "review" | "complete";

// ── Meta ─────────────────────────────────────────────────────────────────────

export const meta: MetaFunction = () => [{ title: "Import | Card Yeti Sync" }];

// ── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { pricingApiConfigured: isPricingApiConfigured() };
};

// ── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  // ── Parse CSV ────────────────────────────────────────────────────────────
  if (intent === "parse-csv") {
    const file = formData.get("csvFile");
    if (!file || !(file instanceof File)) {
      return { error: "No CSV file provided" };
    }

    const csvText = await file.text();
    const { cards, totalRows, skippedRows, errors } =
      parseEbayFileExchangeCSV(csvText);

    if (errors.length > 0) {
      return { error: errors.join("; "), cards: [], totalRows: 0, skippedRows: 0, pricingApiUsed: false, errors } satisfies ParseResponse & { error: string };
    }

    if (cards.length === 0) {
      return { error: "No valid products found in CSV", cards: [], totalRows, skippedRows, pricingApiUsed: false, errors: [] } satisfies ParseResponse & { error: string };
    }

    // Enrich with pricing API
    const pricingApiUsed = await enrichWithPricing(cards);

    // Check for duplicates
    await checkDuplicates(admin, cards);

    return {
      cards,
      totalRows,
      skippedRows,
      pricingApiUsed,
      errors: [],
    } satisfies ParseResponse;
  }

  // ── Fetch eBay Items ─────────────────────────────────────────────────────
  if (intent === "fetch-ebay-items") {
    const itemIdsRaw = formData.get("itemIds");
    if (!itemIdsRaw || typeof itemIdsRaw !== "string") {
      return { error: "No eBay item IDs provided" };
    }

    const itemIds = itemIdsRaw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (itemIds.length === 0) {
      return { error: "No valid eBay item IDs provided" };
    }

    // Dynamic import to avoid loading eBay Browse API code if not needed
    const { fetchEbayItems } = await import(
      "../lib/import/ebay-browse.server"
    );

    const { cards, errors: fetchErrors } = await fetchEbayItems(itemIds);

    if (cards.length === 0) {
      return {
        error: fetchErrors.length > 0
          ? fetchErrors.map((e) => `${e.itemId}: ${e.error}`).join("; ")
          : "No items fetched from eBay",
        cards: [],
        totalRows: itemIds.length,
        skippedRows: itemIds.length,
        pricingApiUsed: false,
        errors: fetchErrors.map((e) => `${e.itemId}: ${e.error}`),
      } satisfies ParseResponse & { error: string };
    }

    // Enrich with pricing API
    const pricingApiUsed = await enrichWithPricing(cards);

    await checkDuplicates(admin, cards);

    return {
      cards,
      totalRows: itemIds.length,
      skippedRows: itemIds.length - cards.length,
      pricingApiUsed,
      errors: fetchErrors.map((e) => `${e.itemId}: ${e.error}`),
    } satisfies ParseResponse;
  }

  // ── Create Products ──────────────────────────────────────────────────────
  if (intent === "create-products") {
    const cardsJson = formData.get("cards");
    if (!cardsJson || typeof cardsJson !== "string") {
      return { error: "No cards data provided" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cardsJson);
    } catch {
      return { error: "Invalid cards data" };
    }
    if (!Array.isArray(parsed)) {
      return { error: "Invalid cards data: expected an array" };
    }
    const selectedCards: ParsedCard[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" || item === null ||
        typeof item.sourceId !== "string" ||
        typeof item.title !== "string" ||
        typeof item.finalPrice !== "number" || !Number.isFinite(item.finalPrice) || item.finalPrice < 0
      ) {
        continue; // skip malformed entries
      }
      selectedCards.push(item as ParsedCard);
    }
    if (selectedCards.length === 0) {
      return { error: "No valid cards to import" };
    }
    const statusRaw = (formData.get("status") as string) || "active";
    const status: "active" | "draft" = statusRaw === "draft" ? "draft" : "active";
    const rotateNewArrivals = formData.get("rotateNewArrivals") === "true";

    // Re-run dedup server-side so a tampered payload cannot bypass duplicate detection
    await checkDuplicates(admin, selectedCards);

    const storeData = await fetchStoreData(admin);

    if (rotateNewArrivals) {
      await removeNewArrivalTags(admin);
    }

    const results: ImportResult[] = [];
    let created = 0;
    let failed = 0;
    let skipped = 0;

    for (const card of selectedCards) {
      if (card.isDuplicate) {
        results.push({
          sourceId: card.sourceId,
          title: card.title,
          status: "skipped",
          shopifyProductId: card.duplicateProductId,
          error: "Duplicate product",
        });
        skipped++;
        continue;
      }

      const result = await createProduct(admin, card, {
        ...storeData,
        status,
        rotateNewArrivals,
      });
      results.push(result);

      if (result.status === "created") created++;
      else if (result.status === "failed") failed++;

      // Log to SyncLog
      try {
        await db.syncLog.create({
          data: {
            shopId: shop,
            marketplace: "shopify",
            action: "import",
            productId: result.shopifyProductId,
            status: result.status === "created" ? "success" : "error",
            details: JSON.stringify({
              title: result.title,
              sourceType: card.sourceType,
              sourceId: card.sourceId,
              error: result.error,
            }),
          },
        });
      } catch (logErr) {
        console.error(
          `Failed to write sync log for ${result.title}:`,
          logErr instanceof Error ? logErr.message : logErr,
        );
      }

      await sleep(DELAY_MS);
    }

    return { results, created, failed, skipped } satisfies CreateResponse;
  }

  return { error: "Unknown intent" };
};

// ── Component ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const { pricingApiConfigured } = useLoaderData<LoaderData>();
  const [importMethod, setImportMethod] = useState<"csv" | "ebay">("csv");
  const [editedCards, setEditedCards] = useState<ParsedCard[] | null>(null);
  const [status, setStatus] = useState("active");
  const [rotateNewArrivals, setRotateNewArrivals] = useState(true);
  const [resetCount, setResetCount] = useState(0);

  const parseFetcher = useFetcher({ key: `parse-${resetCount}` });
  const createFetcher = useFetcher({ key: `create-${resetCount}` });

  // Derive state from fetcher data
  const parseData =
    parseFetcher.data && "cards" in parseFetcher.data
      ? (parseFetcher.data as ParseResponse)
      : null;
  const createData =
    createFetcher.data && "results" in createFetcher.data
      ? (createFetcher.data as CreateResponse)
      : null;

  const parsedCards = editedCards ?? parseData?.cards ?? [];
  const parseInfo = parseData
    ? {
        totalRows: parseData.totalRows,
        skippedRows: parseData.skippedRows,
        pricingApiUsed: parseData.pricingApiUsed,
      }
    : null;

  // Determine step from fetcher state
  let step: Step = "input";
  if (createData) {
    step = "complete";
  } else if (parsedCards.length > 0) {
    step = "review";
  }

  const parseError =
    parseFetcher.data && "error" in parseFetcher.data
      ? (parseFetcher.data as { error: string }).error
      : null;

  const isParsing = parseFetcher.state === "submitting";
  const isCreating = createFetcher.state === "submitting";

  function handleSubmitImport() {
    const selectedCards = parsedCards.filter((c) => c.selected && !c.isDuplicate);
    if (selectedCards.length === 0) return;

    const formData = new FormData();
    formData.set("intent", "create-products");
    formData.set("cards", JSON.stringify(selectedCards));
    formData.set("status", status);
    formData.set("rotateNewArrivals", String(rotateNewArrivals));

    createFetcher.submit(formData, { method: "post" });
  }

  function handleReset() {
    setResetCount((c) => c + 1);
    setEditedCards(null);
  }

  return (
    <s-page heading="Import Products">
      {/* ── Input Step ──────────────────────────────────────────────────── */}
      {step === "input" && (
        <s-stack direction="block" gap="base">
          {parseError && (
            <s-banner tone="critical" dismissible>
              {parseError}
            </s-banner>
          )}

          {!pricingApiConfigured && (
            <s-banner tone="warning">
              Pricing API not configured. Prices will default to eBay
              listing prices. Set PRICING_API_URL and PRICING_API_KEY to
              enable auto-pricing.
            </s-banner>
          )}

          {/* Import method toggle */}
          <s-stack direction="inline" gap="small-100">
            <s-button
              variant={importMethod === "csv" ? "primary" : "secondary"}
              onClick={() => setImportMethod("csv")}
            >
              CSV Upload
            </s-button>
            <s-button
              variant={importMethod === "ebay" ? "primary" : "secondary"}
              onClick={() => setImportMethod("ebay")}
            >
              eBay Item IDs
            </s-button>
          </s-stack>

          {/* CSV Upload */}
          {importMethod === "csv" && (
            <s-section heading="Upload eBay File Exchange CSV">
              <s-stack direction="block" gap="base">
                <s-text>
                  Upload the CSV exported from eBay File Exchange. Card
                  data (name, set, grade, price, images) will be extracted
                  automatically.
                </s-text>
                <parseFetcher.Form
                  method="post"
                  encType="multipart/form-data"
                >
                  <input type="hidden" name="intent" value="parse-csv" />
                  <s-stack direction="block" gap="base">
                    <input
                      type="file"
                      name="csvFile"
                      accept=".csv"
                      required
                    />
                    <s-button
                      variant="primary"
                      type="submit"
                      disabled={isParsing || undefined}
                    >
                      {isParsing ? "Parsing..." : "Parse CSV"}
                    </s-button>
                  </s-stack>
                </parseFetcher.Form>
              </s-stack>
            </s-section>
          )}

          {/* eBay Item IDs */}
          {importMethod === "ebay" && (
            <s-section heading="Import by eBay Item ID">
              <s-stack direction="block" gap="base">
                <s-text>
                  Enter eBay item IDs (one per line or comma-separated).
                  Card data will be fetched from the eBay Browse API.
                </s-text>
                <parseFetcher.Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="fetch-ebay-items"
                  />
                  <s-stack direction="block" gap="base">
                    <textarea
                      name="itemIds"
                      rows={5}
                      placeholder={"325678901234\n325678905678\n..."}
                      required
                      style={{
                        width: "100%",
                        padding: "8px",
                        border:
                          "1px solid var(--s-color-border-secondary)",
                        borderRadius: "4px",
                        fontFamily: "monospace",
                      }}
                    />
                    <s-button
                      variant="primary"
                      type="submit"
                      disabled={isParsing || undefined}
                    >
                      {isParsing ? "Fetching..." : "Fetch from eBay"}
                    </s-button>
                  </s-stack>
                </parseFetcher.Form>
              </s-stack>
            </s-section>
          )}
        </s-stack>
      )}

      {/* ── Review Step ─────────────────────────────────────────────────── */}
      {step === "review" && (
        <s-stack direction="block" gap="base">
          {/* Summary banner */}
          <s-banner tone="info">
            Found {parsedCards.length} products
            {parseInfo?.skippedRows
              ? ` (${parseInfo.skippedRows} rows skipped)`
              : ""}
            .
            {parseInfo?.pricingApiUsed && (
              <>
                {" "}
                API pricing applied to{" "}
                {parsedCards.filter((c) => c.apiSuggestedPrice !== null).length}{" "}
                graded cards.
              </>
            )}
            {parsedCards.filter((c) => c.isDuplicate).length > 0 && (
              <>
                {" "}
                {parsedCards.filter((c) => c.isDuplicate).length} duplicates
                detected.
              </>
            )}
          </s-banner>

          {/* Parse warnings — dedup failures, per-card errors */}
          {(() => {
            const cardsWithErrors = parsedCards.filter((c) => c.parseErrors.length > 0);
            const dedupUnavailableCount = parsedCards.filter((c) => c.dedupUnavailable).length;
            if (cardsWithErrors.length === 0) return null;
            return (
              <s-banner tone="warning" dismissible>
                <s-stack direction="block" gap="small">
                  <s-text type="strong">
                    {cardsWithErrors.length} item{cardsWithErrors.length !== 1 ? "s" : ""} had warnings
                    {dedupUnavailableCount > 0 && ` (${dedupUnavailableCount} could not be checked for duplicates)`}
                  </s-text>
                  <ul style={{ margin: 0, paddingLeft: "1.2em", fontSize: "13px" }}>
                    {cardsWithErrors.slice(0, 10).map((c) => (
                      <li key={c.sourceId}>
                        {c.pokemon || c.title.substring(0, 30)}: {c.parseErrors.join("; ")}
                      </li>
                    ))}
                    {cardsWithErrors.length > 10 && (
                      <li>...and {cardsWithErrors.length - 10} more</li>
                    )}
                  </ul>
                </s-stack>
              </s-banner>
            );
          })()}

          {/* Review table */}
          <ImportReviewTable
            cards={parsedCards}
            onCardsChange={setEditedCards}
          />

          {/* Options */}
          <s-section heading="Import Options">
            <s-stack direction="inline" gap="large" alignItems="center">
              <label>
                <input
                  type="checkbox"
                  checked={rotateNewArrivals}
                  onChange={(e) =>
                    setRotateNewArrivals(e.target.checked)
                  }
                />{" "}
                Rotate new-arrival tags
              </label>
              <label>
                Status:{" "}
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
            </s-stack>
          </s-section>

          {/* Actions */}
          <s-stack direction="inline" gap="base">
            <s-button onClick={handleReset}>Back</s-button>
            <s-button
              variant="primary"
              onClick={handleSubmitImport}
              disabled={
                isCreating ||
                parsedCards.filter((c) => c.selected && !c.isDuplicate)
                  .length === 0 ||
                undefined
              }
            >
              {isCreating
                ? "Importing..."
                : `Import ${parsedCards.filter((c) => c.selected && !c.isDuplicate).length} Products`}
            </s-button>
          </s-stack>
        </s-stack>
      )}

      {/* ── Complete Step ───────────────────────────────────────────────── */}
      {step === "complete" && createData && (
        <s-stack direction="block" gap="base">
          <s-banner
            tone={createData.failed > 0 ? "warning" : "success"}
          >
            Import complete: {createData.created} created
            {createData.failed > 0 ? `, ${createData.failed} failed` : ""}
            {createData.skipped > 0 ? `, ${createData.skipped} skipped` : ""}
          </s-banner>

          <s-section heading="Results">
            <div style={{ overflowX: "auto" }}>
              <table
                style={{ width: "100%", borderCollapse: "collapse" }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom:
                        "1px solid var(--s-color-border-secondary)",
                    }}
                  >
                    <th style={{ padding: "8px", textAlign: "left" }}>
                      Product
                    </th>
                    <th style={{ padding: "8px", textAlign: "left" }}>
                      Status
                    </th>
                    <th style={{ padding: "8px", textAlign: "left" }}>
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {createData.results.map((r: ImportResult) => (
                    <tr
                      key={r.sourceId}
                      style={{
                        borderBottom:
                          "1px solid var(--s-color-border-secondary)",
                      }}
                    >
                      <td style={{ padding: "8px" }}>{r.title}</td>
                      <td style={{ padding: "8px" }}>
                        {r.status === "created" && (
                          <s-badge tone="success">Created</s-badge>
                        )}
                        {r.status === "failed" && (
                          <s-badge tone="critical">Failed</s-badge>
                        )}
                        {r.status === "skipped" && (
                          <s-badge tone="warning">Skipped</s-badge>
                        )}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {r.error ? (
                          <s-text tone="critical">
                            {r.error}
                          </s-text>
                        ) : r.shopifyProductId ? (
                          <s-text tone="neutral">
                            {r.shopifyProductId}
                          </s-text>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-section>

          <s-button variant="primary" onClick={handleReset}>
            Import More
          </s-button>
        </s-stack>
      )}
    </s-page>
  );
}

// ── Error Boundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
