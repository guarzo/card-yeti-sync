-- CreateTable
CREATE TABLE "MarketplaceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiry" DATETIME,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "marketplaceId" TEXT,
    "offerId" TEXT,
    "status" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketplaceListing_shopId_marketplace_fkey" FOREIGN KEY ("shopId", "marketplace") REFERENCES "MarketplaceAccount" ("shopId", "marketplace") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "productId" TEXT,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceAccount_shopId_marketplace_key" ON "MarketplaceAccount"("shopId", "marketplace");

-- CreateIndex
CREATE INDEX "MarketplaceListing_shopId_marketplace_status_idx" ON "MarketplaceListing"("shopId", "marketplace", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_shopId_shopifyProductId_marketplace_key" ON "MarketplaceListing"("shopId", "shopifyProductId", "marketplace");

-- CreateIndex
CREATE INDEX "SyncLog_shopId_createdAt_idx" ON "SyncLog"("shopId", "createdAt");
