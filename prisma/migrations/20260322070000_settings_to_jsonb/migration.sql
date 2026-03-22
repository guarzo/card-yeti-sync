-- Safe JSON conversion helper (auto-cleaned up with session via pg_temp schema)
CREATE OR REPLACE FUNCTION pg_temp.safe_to_jsonb(text) RETURNS jsonb AS $$
BEGIN
  RETURN $1::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN '{}'::jsonb;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- AlterColumn: change settings from TEXT to JSONB with safe fallback for invalid values
ALTER TABLE "MarketplaceAccount" ALTER COLUMN "settings" SET DATA TYPE JSONB USING pg_temp.safe_to_jsonb(COALESCE("settings", '{}'));
ALTER TABLE "MarketplaceAccount" ALTER COLUMN "settings" SET DEFAULT '{}';
