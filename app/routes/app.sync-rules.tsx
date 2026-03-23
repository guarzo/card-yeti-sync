import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { MARKETPLACE_CONFIG, type MarketplaceKey } from "../lib/marketplace-config";
import { type SyncRules, DEFAULT_SYNC_RULES, PRODUCT_TYPES } from "../lib/sync-rules";
import { getSyncRules } from "../lib/sync-rules.server";
import { getAccountSettings } from "../lib/account-settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const accounts = await db.marketplaceAccount.findMany({
    where: { shopId: session.shop },
    select: { marketplace: true, settings: true },
  });

  const rulesByMarketplace: Record<string, SyncRules> = {};
  const discountByMarketplace: Record<string, number> = {};
  for (const account of accounts) {
    rulesByMarketplace[account.marketplace] = getSyncRules(account);
    const settings = getAccountSettings(account);
    discountByMarketplace[account.marketplace] = settings.discountPercent;
  }

  return { rulesByMarketplace, discountByMarketplace, connectedMarketplaces: accounts.map((a) => a.marketplace) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const marketplace = formData.get("marketplace")?.toString();
  if (!marketplace) {
    return Response.json({ error: "Missing marketplace", marketplace: "" }, { status: 400 });
  }

  const account = await db.marketplaceAccount.findUnique({
    where: { shopId_marketplace: { shopId: session.shop, marketplace } },
  });
  if (!account) {
    return Response.json({ error: "Marketplace not connected", marketplace }, { status: 400 });
  }

  const selectedTypes = formData.getAll("productTypes").map((v) => v.toString());
  const excludeTagsRaw = formData.get("excludeTags")?.toString() ?? "";
  const priceMinRaw = formData.get("priceMin")?.toString();
  const priceMaxRaw = formData.get("priceMax")?.toString();
  const autoSyncNew = formData.get("autoSyncNew") === "on";

  const priceMin = priceMinRaw ? parseFloat(priceMinRaw) : null;
  const priceMax = priceMaxRaw ? parseFloat(priceMaxRaw) : null;

  if (priceMin !== null && !Number.isFinite(priceMin)) {
    return Response.json({ error: "Invalid minimum price", marketplace }, { status: 400 });
  }
  if (priceMax !== null && !Number.isFinite(priceMax)) {
    return Response.json({ error: "Invalid maximum price", marketplace }, { status: 400 });
  }
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    return Response.json({ error: "Minimum price must not exceed maximum price", marketplace }, { status: 400 });
  }

  const syncRules: SyncRules = {
    productTypes: selectedTypes.length > 0 ? selectedTypes : DEFAULT_SYNC_RULES.productTypes,
    excludeTags: excludeTagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    priceMin,
    priceMax,
    autoSyncNew,
  };

  const discountRaw = formData.get("discountPercent")?.toString()?.trim();
  const discountPercent = discountRaw ? Number(discountRaw) : 5;

  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return Response.json({ error: "Discount must be between 0 and 100", marketplace }, { status: 400 });
  }

  const currentSettings = (account.settings ?? {}) as Record<string, unknown>;
  const newSettings: Prisma.InputJsonValue = {
    ...currentSettings,
    syncRules: syncRules as unknown as Prisma.InputJsonValue,
    discountPercent,
  };
  await db.marketplaceAccount.update({
    where: { id: account.id },
    data: {
      settings: newSettings,
    },
  });

  return Response.json({ success: true });
};

export default function SyncRulesPage() {
  const { rulesByMarketplace, discountByMarketplace, connectedMarketplaces } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (connectedMarketplaces.length === 0) {
    return (
      <s-page heading="Sync Rules">
        <s-box padding="large" borderWidth="base" borderRadius="base">
          <s-text color="subdued">
            No marketplaces connected. Connect a marketplace first to configure sync rules.
          </s-text>
        </s-box>
      </s-page>
    );
  }

  return (
    <s-page heading="Sync Rules">
      <s-stack direction="block" gap="large">
        <s-text color="subdued">
          Configure which products get synced or exported for each connected marketplace.
        </s-text>

        {connectedMarketplaces.map((mp) => {
          const rules = rulesByMarketplace[mp] ?? DEFAULT_SYNC_RULES;
          const config = MARKETPLACE_CONFIG[mp as MarketplaceKey];
          const label = config?.label ?? mp;

          return (
            <s-box key={mp} padding="base" borderWidth="base" borderRadius="base">
              <Form method="post">
                <input type="hidden" name="marketplace" value={mp} />
                <s-stack direction="block" gap="base">
                  <s-text type="strong">{label} Sync Rules</s-text>
                  <s-divider />

                  <s-text type="strong">Product Types</s-text>
                  <s-stack direction="block" gap="small">
                    {PRODUCT_TYPES.map((type) => (
                      <label key={type} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <input
                          type="checkbox"
                          name="productTypes"
                          value={type}
                          defaultChecked={rules.productTypes.includes(type)}
                        />
                        {type}
                      </label>
                    ))}
                  </s-stack>

                  <label htmlFor={`excludeTags-${mp}`}>
                    <s-text type="strong">Exclude Tags</s-text>
                  </label>
                  <s-text color="subdued">Comma-separated list of tags to exclude from sync</s-text>
                  <input
                    id={`excludeTags-${mp}`}
                    type="text"
                    name="excludeTags"
                    defaultValue={rules.excludeTags.join(", ")}
                    placeholder="do-not-sync, hold"
                    style={{ width: "100%", padding: "0.5rem" }}
                  />

                  <s-text type="strong">Price Range</s-text>
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <label htmlFor={`priceMin-${mp}`}>
                      <s-text>Min</s-text>
                    </label>
                    <input
                      id={`priceMin-${mp}`}
                      type="number"
                      name="priceMin"
                      defaultValue={rules.priceMin ?? ""}
                      placeholder="Min"
                      style={{ width: "100px", padding: "0.5rem" }}
                    />
                    <s-text>to</s-text>
                    <label htmlFor={`priceMax-${mp}`}>
                      <s-text>Max</s-text>
                    </label>
                    <input
                      id={`priceMax-${mp}`}
                      type="number"
                      name="priceMax"
                      defaultValue={rules.priceMax ?? ""}
                      placeholder="Max"
                      style={{ width: "100px", padding: "0.5rem" }}
                    />
                  </s-stack>

                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      name="autoSyncNew"
                      defaultChecked={rules.autoSyncNew}
                    />
                    <s-text>Auto-sync new products</s-text>
                  </label>

                  <s-divider />

                  <label htmlFor={`discountPercent-${mp}`}>
                    <s-text type="strong">Shopify Discount %</s-text>
                  </label>
                  <s-text color="subdued">
                    Shopify storefront price will be this much lower than the marketplace listing price.
                  </s-text>
                  <input
                    id={`discountPercent-${mp}`}
                    type="number"
                    name="discountPercent"
                    defaultValue={discountByMarketplace[mp] ?? 5}
                    min="0"
                    max="100"
                    step="0.5"
                    style={{ width: "100px", padding: "0.5rem" }}
                  />

                  {actionData && "error" in actionData && (actionData as { marketplace: string }).marketplace === mp && (
                    <s-banner tone="critical">
                      {(actionData as { error: string }).error}
                    </s-banner>
                  )}
                  <s-button variant="primary" type="submit">Save {label} Rules</s-button>
                </s-stack>
              </Form>
            </s-box>
          );
        })}
      </s-stack>
    </s-page>
  );
}
