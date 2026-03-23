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

  function updateFinalPrice(sourceId: string, value: string) {
    const numVal = parseFloat(value);
    if (isNaN(numVal) || numVal < 0) return;
    onCardsChange(
      cards.map((c) =>
        c.sourceId === sourceId ? { ...c, finalPrice: numVal } : c,
      ),
    );
  }

  const selectedCount = cards.filter((c) => c.selected).length;
  const selectedTotal = cards
    .filter((c) => c.selected)
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
              {cards.map((card) => (
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
                    />
                  </td>
                  <td style={{ padding: "8px" }}>
                    <div>
                      <strong>
                        {card.pokemon || card.title.substring(0, 40)}
                      </strong>
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
                        value={card.finalPrice.toFixed(2)}
                        onChange={(e) =>
                          updateFinalPrice(card.sourceId, e.target.value)
                        }
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
                      <s-badge tone="warning">Duplicate</s-badge>
                    ) : card.apiSuggestedPrice !== null ? (
                      <s-badge tone="success">API priced</s-badge>
                    ) : (
                      <s-badge tone="info">eBay price</s-badge>
                    )}
                  </td>
                </tr>
              ))}
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
