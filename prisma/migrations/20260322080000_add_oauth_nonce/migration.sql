-- CreateTable
CREATE TABLE "OAuthNonce" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthNonce_nonce_key" ON "OAuthNonce"("nonce");

-- CreateIndex
CREATE INDEX "OAuthNonce_shopId_idx" ON "OAuthNonce"("shopId");

-- CreateIndex
CREATE INDEX "OAuthNonce_expiresAt_idx" ON "OAuthNonce"("expiresAt");
