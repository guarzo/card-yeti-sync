-- CreateTable
CREATE TABLE "PriceSuggestion" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "currentPrice" DECIMAL(65,30) NOT NULL,
    "suggestedPrice" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceSuggestion_shopId_shopifyProductId_status_key" ON "PriceSuggestion"("shopId", "shopifyProductId", "status");

-- CreateIndex
CREATE INDEX "PriceSuggestion_shopId_status_idx" ON "PriceSuggestion"("shopId", "status");
