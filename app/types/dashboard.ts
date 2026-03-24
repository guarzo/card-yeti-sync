import type { MarketplaceKey } from "../lib/marketplace-config";

export interface Product {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  productType: string;
  featuredImage: { url: string } | null;
  price: string | null;
}

export interface SyncLogEntry {
  id: string;
  marketplace: string;
  action: string;
  status: string;
  productTitle: string | null;
  createdAt: string;
}

export interface MarketplaceInfo {
  connected: boolean;
  activeCount: number;
  errorCount: number;
  pendingCount: number;
  tokenExpiry: string | null;
  lastExportDate: string | null;
}

export interface PriceSuggestion {
  id: string;
  shopifyProductId: string;
  currentPrice: string;
  suggestedPrice: string;
  reason: string | null;
  productTitle?: string;
  source?: string;
  certNumber?: string;
}

export interface ListingStatus {
  marketplace: string;
  status: string;
  errorMessage: string | null;
  lastSyncedAt: string | null;
}

export interface LoaderData {
  products: Product[];
  productCount: number;
  activeProductCount: number;
  marketplaces: Record<string, MarketplaceInfo>;
  recentLogs: SyncLogEntry[];
  listingsByProduct: Record<string, ListingStatus[]>;
  priceSuggestions: Record<string, PriceSuggestion>;
  pendingPriceReviews: number;
  connectedMarketplaces: MarketplaceKey[];
  productsAwaitingSync: number;
  totalActiveListings: number;
  totalPendingSyncs: number;
  totalErrors: number;
  hasNextPage: boolean;
  endCursor: string | null;
}
