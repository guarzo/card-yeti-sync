-- AlterColumn: change settings from TEXT to JSONB
ALTER TABLE "MarketplaceAccount" ALTER COLUMN "settings" SET DATA TYPE JSONB USING "settings"::jsonb;
ALTER TABLE "MarketplaceAccount" ALTER COLUMN "settings" SET DEFAULT '{}';
