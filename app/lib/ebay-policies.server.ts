import type { MarketplaceAccount } from "@prisma/client";
import { ebayApiCall } from "./ebay-client.server";

const MARKETPLACE_ID = "EBAY_US";

interface Policy {
  id: string;
  name: string;
  description?: string;
}

interface PolicySet {
  fulfillment: Policy[];
  payment: Policy[];
  return: Policy[];
}

/**
 * Fetch all existing business policies from the seller's eBay account.
 */
export async function getExistingPolicies(account: MarketplaceAccount): Promise<PolicySet> {
  const types = ["fulfillment", "payment", "return"] as const;
  const result: PolicySet = { fulfillment: [], payment: [], return: [] };

  for (const type of types) {
    const { response } = await ebayApiCall(
      "GET",
      `/sell/account/v1/${type}_policy?marketplace_id=${MARKETPLACE_ID}`,
      null,
      account,
    );

    if (response.ok) {
      const data = await response.json();
      const policies = data[`${type}Policies`] ?? [];
      result[type] = policies.map((p: Record<string, string>) => ({
        id: p[`${type}PolicyId`],
        name: p.name,
        description: p.description,
      }));
    }
  }

  return result;
}

/**
 * Create a fulfillment policy with Card Yeti defaults.
 * USPS Ground Advantage + First Class + Priority, 1 day handling, free shipping over $75.
 */
export async function createFulfillmentPolicy(
  account: MarketplaceAccount,
  config?: { name?: string },
): Promise<{ policyId: string }> {
  const body = {
    name: config?.name ?? "Card Yeti - Standard Shipping",
    description: "USPS shipping with free shipping over $75",
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "CALCULATED",
        shippingServices: [
          {
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSGroundAdvantage",
            sortOrder: 1,
            freeShipping: false,
          },
          {
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSFirstClass",
            sortOrder: 2,
            freeShipping: false,
          },
          {
            shippingCarrierCode: "USPS",
            shippingServiceCode: "USPSPriority",
            sortOrder: 3,
            freeShipping: false,
          },
        ],
      },
    ],
  };

  const { response } = await ebayApiCall(
    "POST",
    "/sell/account/v1/fulfillment_policy",
    body,
    account,
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Failed to create fulfillment policy: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  return { policyId: data.fulfillmentPolicyId };
}

/**
 * Create a payment policy — immediate payment required, eBay managed payments.
 */
export async function createPaymentPolicy(
  account: MarketplaceAccount,
  config?: { name?: string },
): Promise<{ policyId: string }> {
  const body = {
    name: config?.name ?? "Card Yeti - Immediate Payment",
    description: "Immediate payment required via eBay managed payments",
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    immediatePay: true,
    paymentMethods: [{ paymentMethodType: "PERSONAL_CHECK" }],
  };

  const { response } = await ebayApiCall(
    "POST",
    "/sell/account/v1/payment_policy",
    body,
    account,
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Failed to create payment policy: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  return { policyId: data.paymentPolicyId };
}

/**
 * Create a return policy — 30-day returns, buyer pays return shipping.
 */
export async function createReturnPolicy(
  account: MarketplaceAccount,
  config?: { name?: string },
): Promise<{ policyId: string }> {
  const body = {
    name: config?.name ?? "Card Yeti - 30 Day Returns",
    description: "30-day returns accepted, buyer pays return shipping",
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: "DAY" },
    returnShippingCostPayer: "BUYER",
    refundMethod: "MONEY_BACK",
  };

  const { response } = await ebayApiCall(
    "POST",
    "/sell/account/v1/return_policy",
    body,
    account,
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Failed to create return policy: ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  return { policyId: data.returnPolicyId };
}
