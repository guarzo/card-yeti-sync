-- AlterTable
ALTER TABLE "PriceSuggestion" ADD COLUMN     "certNumber" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';
