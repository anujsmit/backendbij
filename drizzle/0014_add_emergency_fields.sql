ALTER TABLE "service_requests"
  ADD COLUMN "is_emergency" boolean DEFAULT false NOT NULL,
  ADD COLUMN "emergency_surge_multiplier" numeric(3, 2),
  ADD COLUMN "emergency_base_price" numeric(10, 2),
  ADD COLUMN "emergency_final_price" numeric(10, 2);
--> statement-breakpoint
CREATE INDEX "service_requests_emergency_pending_idx"
  ON "service_requests" USING btree ("is_emergency", "status")
  WHERE "is_emergency" = true AND "status" = 'pending';
