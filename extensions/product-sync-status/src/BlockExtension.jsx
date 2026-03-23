import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

const STATUS_BADGES = {
  active: { tone: "success", label: "Active" },
  pending: { tone: "caution", label: "Pending" },
  error: { tone: "critical", label: "Error" },
  delisted: { tone: undefined, label: "Delisted" },
};

const MARKETPLACE_LABELS = {
  ebay: "eBay",
  whatnot: "Whatnot",
  helix: "Helix",
};

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Extension() {
  const { i18n, data } = shopify;
  const [listings, setListings] = useState(null);
  const [connected, setConnected] = useState([]);
  const [loading, setLoading] = useState(true);

  const productId = data?.selected?.[0]?.id;

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }

    fetch(`/api/product-sync-status?productId=${encodeURIComponent(productId)}`)
      .then((r) => r.json())
      .then((data) => {
        setListings(data.listings || []);
        setConnected(data.connectedMarketplaces || []);
      })
      .catch(() => {
        setListings([]);
        setConnected([]);
      })
      .finally(() => setLoading(false));
  }, [productId]);

  return (
    <s-admin-block heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="base">
        {loading && (
          <s-text color="subdued">{i18n.translate("loading")}</s-text>
        )}

        {!loading && connected.length === 0 && (
          <s-text color="subdued">{i18n.translate("noMarketplaces")}</s-text>
        )}

        {!loading &&
          connected.map((mp) => {
            const listing = listings?.find((l) => l.marketplace === mp);
            const badge = listing
              ? STATUS_BADGES[listing.status] || STATUS_BADGES.pending
              : null;
            const label = MARKETPLACE_LABELS[mp] || mp;

            return (
              <s-box
                key={mp}
                padding="small"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-text type="strong">{label}</s-text>
                  {badge ? (
                    <s-badge tone={badge.tone}>{badge.label}</s-badge>
                  ) : (
                    <s-badge>{i18n.translate("notListed")}</s-badge>
                  )}
                </s-stack>

                {listing?.lastSyncedAt && (
                  <s-text color="subdued" size="small">
                    {i18n.translate("lastSynced")}: {timeAgo(listing.lastSyncedAt)}
                  </s-text>
                )}

                {listing?.status === "error" && listing.errorMessage && (
                  <s-text color="critical" size="small">
                    {listing.errorMessage}
                  </s-text>
                )}

                {listing?.marketplaceId && mp === "ebay" && (
                  <s-link href={`https://www.ebay.com/itm/${listing.marketplaceId}`} external>
                    View on eBay
                  </s-link>
                )}
              </s-box>
            );
          })}
      </s-stack>
    </s-admin-block>
  );
}
