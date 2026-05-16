-- Drop emergency-related index if it exists
DROP INDEX IF EXISTS "service_requests_emergency_pending_idx";

-- Remove emergency columns from service_requests table
ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "is_emergency";
ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "emergency_surge_multiplier";
ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "emergency_base_price";
ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "emergency_final_price";
