import { useEffect, useState } from "react";
import { Form } from "react-router";

interface PriceSuggestion {
  id: string;
  shopifyProductId: string;
  currentPrice: string;
  suggestedPrice: string;
  reason: string | null;
  productTitle?: string;
}

interface BulkApproveModalProps {
  suggestions: PriceSuggestion[];
  open: boolean;
  onClose: () => void;
}

export function BulkApproveModal({
  suggestions,
  open,
  onClose,
}: BulkApproveModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(suggestions.map((s) => s.id)),
  );

  // Reset selection when suggestions change (e.g., after inline approval)
  useEffect(() => {
    setSelected(new Set(suggestions.map((s) => s.id)));
  }, [suggestions]);

  if (!open || suggestions.length === 0) return null;

  const allSelected = selected.size === suggestions.length;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(suggestions.map((s) => s.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.3)",
      }}
    >
      <div
        style={{
          maxHeight: "80vh",
          overflow: "auto",
          width: "min(600px, 90vw)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
        }}
      >
        <s-box
          padding="large"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" alignItems="center">
              <s-text type="strong">Review Price Suggestions</s-text>
            </s-stack>

            <s-divider />

            <s-switch
              label={`Select all (${suggestions.length})`}
              checked={allSelected}
              onChange={toggleAll}
            />

            {suggestions.map((s) => (
              <s-stack
                key={s.id}
                direction="inline"
                gap="base"
                alignItems="center"
              >
                <s-switch
                  label=""
                  checked={selected.has(s.id)}
                  onChange={() => toggleOne(s.id)}
                />
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{s.productTitle ?? s.shopifyProductId}</s-text>
                  <s-text color="subdued">
                    ${s.currentPrice} → ${s.suggestedPrice}
                    {s.reason && ` · ${s.reason}`}
                  </s-text>
                </s-stack>
              </s-stack>
            ))}

            <s-divider />

            <s-stack direction="inline" gap="base">
              <s-button variant="secondary" onClick={() => onClose()}>
                Cancel
              </s-button>
              <Form method="post">
                <input type="hidden" name="intent" value="bulk-approve-prices" />
                {Array.from(selected).map((id) => (
                  <input key={id} type="hidden" name="suggestionIds" value={id} />
                ))}
                <s-button
                  variant="primary"
                  type="submit"
                  disabled={selected.size === 0}
                >
                  Approve {selected.size} suggestion{selected.size !== 1 ? "s" : ""}
                </s-button>
              </Form>
            </s-stack>
          </s-stack>
        </s-box>
      </div>
    </div>
  );
}
