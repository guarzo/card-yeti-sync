import { useState } from "react";
import type { ParsedCard } from "../../lib/import/types";

interface ImportReviewTableProps {
  cards: ParsedCard[];
  onCardsChange: (cards: ParsedCard[]) => void;
}

function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || price === 0) return "—";
  return `$${price.toFixed(2)}`;
}

export function ImportReviewTable({
  cards,
  onCardsChange,
}: ImportReviewTableProps) {
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});

  const selectableCards = cards.filter((c) => !c.isDuplicate);
  const allSelected =
    selectableCards.length > 0 && selectableCards.every((c) => c.selected);

  function toggleAll() {
    const newVal = !allSelected;
    onCardsChange(
      cards.map((c) =>
        c.isDuplicate ? c : { ...c, selected: newVal },
      ),
    );
  }

  function toggleCard(sourceId: string) {
    onCardsChange(
      cards.map((c) =>
        c.sourceId === sourceId ? { ...c, selected: !c.selected } : c,
      ),
    );
  }

  function commitFinalPrice(sourceId: string) {
    const draft = priceDrafts[sourceId];
    if (draft === undefined) return;
    const numVal = parseFloat(draft);
    setPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    if (isNaN(numVal) || numVal < 0) return;
    onCardsChange(
      cards.map((c) =>
        c.sourceId === sourceId ? { ...c, finalPrice: numVal } : c,
      ),
    );
  }

  const selectedCount = cards.filter((c) => c.selected && !c.isDuplicate).length;
  const selectedTotal = cards
    .filter((c) => c.selected && !c.isDuplicate)
    .reduce((sum, c) => sum + c.finalPrice, 0);

  return (
    <s-stack direction="block" gap="base">
      <s-section>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--s-color-border-secondary)",
                }}
              >
                <th style={{ padding: "8px", textAlign: "left" }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th style={{ padding: "8px", textAlign: "left" }}>Card</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Type</th>
                <th style={{ padding: "8px", textAlign: "right" }}>
                  eBay Price
                </th>
                <th style={{ padding: "8px", textAlign: "right" }}>
                  API Price
                </th>
                <th style={{ padding: "8px", textAlign: "right" }}>
                  Final Price
                </th>
                <th style={{ padding: "8px", textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => {
                const cardLabel = card.pokemon || card.title.substring(0, 40);
                return (
                  <tr
                    key={card.sourceId}
                    style={{
                      borderBottom:
                        "1px solid var(--s-color-border-secondary)",
                      opacity: card.isDuplicate ? 0.5 : 1,
                    }}
                  >
                    <td style={{ padding: "8px" }}>
                      <input
                        type="checkbox"
                        checked={card.selected}
                        disabled={card.isDuplicate}
                        onChange={() => toggleCard(card.sourceId)}
                        aria-label={`Select ${cardLabel}${card.customLabel ? ` (SKU: ${card.customLabel})` : ""}`}
                      />
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div>
                        <strong>{cardLabel}</strong>
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--s-color-text-secondary)",
                        }}
                      >
                        {card.setName}
                        {card.number ? ` #${card.number}` : ""}
                        {card.language !== "English"
                          ? ` [${card.language}]`
                          : ""}
                      </div>
                      {card.customLabel && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--s-color-text-secondary)",
                          }}
                        >
                          SKU: {card.customLabel}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {card.isGraded ? (
                        <s-badge>
                          {card.grader} {card.grade}
                        </s-badge>
                      ) : (
                        <s-badge tone="info">Raw</s-badge>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {formatPrice(card.ebayPrice)}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {card.apiSuggestedPrice !== null ? (
                        <span style={{ color: "var(--s-color-text-success)" }}>
                          {formatPrice(card.apiSuggestedPrice)}
                        </span>
                      ) : (
                        <span
                          style={{
                            color: "var(--s-color-text-secondary)",
                          }}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {card.isDuplicate ? (
                        formatPrice(card.finalPrice)
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={priceDrafts[card.sourceId] ?? card.finalPrice.toString()}
                          onChange={(e) =>
                            setPriceDrafts((prev) => ({
                              ...prev,
                              [card.sourceId]: e.target.value,
                            }))
                          }
                          onBlur={() => commitFinalPrice(card.sourceId)}
                          aria-label={`Final price for ${cardLabel}`}
                          style={{
                            width: "90px",
                            textAlign: "right",
                            padding: "4px 6px",
                            border:
                              "1px solid var(--s-color-border-secondary)",
                            borderRadius: "4px",
                          }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {card.isDuplicate ? (
                        card.duplicateFieldDiffs.length > 0 ? (
                          <div>
                            <s-badge tone="critical">Changed</s-badge>
                            <div style={{ fontSize: "11px", color: "var(--s-color-text-secondary)", marginTop: "2px" }}>
                              {card.duplicateFieldDiffs.join(", ")}
                            </div>
                          </div>
                        ) : (
                          <s-badge tone="warning">Exact duplicate</s-badge>
                        )
                      ) : card.apiSuggestedPrice !== null ? (
                        <s-badge tone="success">API priced</s-badge>
                      ) : (
                        <s-badge tone="info">eBay price</s-badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </s-section>

      <s-stack direction="inline" gap="base" alignItems="center">
        <s-text>
          {selectedCount} of {cards.length} selected
        </s-text>
        <s-text type="strong">
          Total: ${selectedTotal.toFixed(2)}
        </s-text>
      </s-stack>
    </s-stack>
  );
}
