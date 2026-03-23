/**
 * eBay Browse API product import.
 *
 * Fetches items by eBay item ID and extracts card data from item specifics.
 */

import { getEbayBrowseItem } from "../ebay-client.server";
import type { EbayBrowseItem } from "../ebay-client.server";
import { parseGraderFromTitle } from "./csv-parser.server";
import { sleep } from "./product-builder.server";
import type { ParsedCard } from "./types";

const BROWSE_API_DELAY_MS = 200;

// Known item specific names from eBay Pokémon card listings
const ITEM_SPECIFIC_KEYS: Record<string, string[]> = {
  pokemon: ["Pokémon Character", "Character", "Pokemon Character", "Pokemon"],
  setName: ["Set", "Card Set"],
  number: ["Card Number", "Card #"],
  grader: ["Professional Grader", "Grading Company", "Grader"],
  grade: ["Grade", "Card Grade"],
  certNumber: ["Certification Number", "Cert Number", "Cert #"],
  language: ["Language"],
  year: ["Year Manufactured", "Year"],
  rarity: ["Rarity"],
  condition: ["Card Condition", "Condition"],
};

function getItemSpecific(
  aspects: Array<{ name: string; value: string }>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const match = aspects.find(
      (a) => a.name.toLowerCase() === key.toLowerCase(),
    );
    if (match) return match.value;
  }
  return null;
}

export function extractCardDataFromEbayItem(
  item: EbayBrowseItem,
  index: number,
): ParsedCard {
  const aspects = item.localizedAspects || [];
  const title = item.title || "";

  // Get grading info — prefer item specifics, fall back to title parsing
  const specificGrader = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.grader);
  const specificGrade = getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.grade);
  const titleInfo = parseGraderFromTitle(title);

  const grader = specificGrader?.toUpperCase() || titleInfo.grader;
  const grade = specificGrade || titleInfo.grade;
  const isGraded = !!(grader && grade);

  const pokemon =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.pokemon) || "";
  const setName =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.setName) || "";
  const number =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.number) || "";
  const certNumber =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.certNumber) || "";
  const language =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.language) || "English";
  const year =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.year) || "";
  const rarity =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.rarity) || "";
  const condition =
    getItemSpecific(aspects, ITEM_SPECIFIC_KEYS.condition) || "";

  const ebayPrice = parseFloat(item.price?.value || "0");

  // Images — optimize to high-res
  const imageUrls: string[] = [];
  if (item.image?.imageUrl) {
    imageUrls.push(item.image.imageUrl.replace(/s-l\d+/, "s-l1600"));
  }
  if (item.additionalImages) {
    for (const img of item.additionalImages) {
      if (img.imageUrl) {
        imageUrls.push(img.imageUrl.replace(/s-l\d+/, "s-l1600"));
      }
    }
  }

  const ebayItemId = item.legacyItemId || item.itemId || "";

  return {
    sourceId: `ebay-${index}`,
    sourceType: "ebay",
    title,
    pokemon,
    setName,
    number,
    grader,
    grade,
    isGraded,
    certNumber,
    language,
    year,
    rarity,
    condition,
    ebayPrice,
    imageUrls,
    description: item.description || "",
    isJapanese: /japanese/i.test(language),
    customLabel: "",
    ebayItemId,

    apiSuggestedPrice: null,
    finalPrice: ebayPrice,

    isDuplicate: false,
    duplicateProductId: null,
    dedupUnavailable: false,
    parseErrors: [],
    selected: true,
  };
}

export async function fetchEbayItems(
  itemIds: string[],
): Promise<{
  cards: ParsedCard[];
  errors: Array<{ itemId: string; error: string }>;
}> {
  const cards: ParsedCard[] = [];
  const errors: Array<{ itemId: string; error: string }> = [];

  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i];
    try {
      const item = await getEbayBrowseItem(itemId);
      const card = extractCardDataFromEbayItem(item, i);
      cards.push(card);
    } catch (err) {
      errors.push({
        itemId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (i < itemIds.length - 1) {
      await sleep(BROWSE_API_DELAY_MS);
    }
  }

  return { cards, errors };
}
