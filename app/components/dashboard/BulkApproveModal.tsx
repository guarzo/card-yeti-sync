import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { PriceSuggestion } from "../../types/dashboard";

interface BulkApproveModalProps {
  suggestions: PriceSuggestion[];
  open: boolean;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
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
};

const dialogStyle: React.CSSProperties = {
  maxHeight: "80vh",
  overflow: "auto",
  width: "min(600px, 90vw)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
};

export function BulkApproveModal({
  suggestions,
  open,
  onClose,
}: BulkApproveModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(suggestions.map((s) => s.id)),
  );
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state === "submitting";

  const result = fetcher.data as
    | {
        approved?: number;
        error?: string;
        partialSuccess?: boolean;
        failed?: number;
      }
    | undefined;

  // Reset selection when suggestions change (e.g., after inline approval)
  const [prevSuggestions, setPrevSuggestions] = useState(suggestions);
  if (suggestions !== prevSuggestions) {
    setPrevSuggestions(suggestions);
    setSelected(new Set(suggestions.map((s) => s.id)));
  }

  // Close on full success
  useEffect(() => {
    if (result?.approved && !result?.partialSuccess) {
      onClose();
    }
  }, [result, onClose]);

  // Escape to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

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
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div
      style={overlayStyle}
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
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
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text color="subdued">
                      ${s.currentPrice} → ${s.suggestedPrice}
                    </s-text>
                    {(() => {
                      const current = parseFloat(s.currentPrice);
                      const suggested = parseFloat(s.suggestedPrice);
                      if (!Number.isFinite(current) || !Number.isFinite(suggested) || current === 0) return null;
                      const rawPct = ((suggested - current) / current) * 100;
                      if (rawPct === 0) return <s-badge tone="success">0%</s-badge>;
                      const isNeg = rawPct < 0;
                      const absRaw = Math.abs(rawPct);
                      const display = absRaw < 1
                        ? (isNeg ? "-<1%" : "+<1%")
                        : `${isNeg ? "-" : "+"}${Math.round(absRaw)}%`;
                      return (
                        <s-badge tone={isNeg ? "critical" : "success"}>
                          {display}
                        </s-badge>
                      );
                    })()}
                    {s.reason && <s-text color="subdued">· {s.reason}</s-text>}
                  </s-stack>
                </s-stack>
              </s-stack>
            ))}

            <s-divider />

            {result?.error && (
              <s-banner tone="critical">{result.error}</s-banner>
            )}
            {result?.partialSuccess && (
              <s-banner tone="warning">
                {result.approved} approved, {result.failed} failed.
              </s-banner>
            )}

            <s-stack direction="inline" gap="base">
              <s-button variant="secondary" onClick={() => onClose()}>
                Cancel
              </s-button>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="bulk-approve-prices" />
                {Array.from(selected).map((id) => (
                  <input key={id} type="hidden" name="suggestionIds" value={id} />
                ))}
                <s-button
                  variant="primary"
                  type="submit"
                  disabled={selected.size === 0 || isSubmitting || undefined}
                >
                  {isSubmitting
                    ? "Approving..."
                    : `Approve ${selected.size} suggestion${selected.size !== 1 ? "s" : ""}`}
                </s-button>
              </fetcher.Form>
            </s-stack>
          </s-stack>
        </s-box>
      </div>
    </div>
  );
}
