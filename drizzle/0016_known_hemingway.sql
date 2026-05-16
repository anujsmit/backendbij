ALTER TABLE "ratings" ADD COLUMN "is_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ratings_is_approved_idx" ON "ratings" USING btree ("is_approved");--> statement-breakpoint
-- Mark all existing reviews as approved (grandfathering existing data)
UPDATE "ratings" SET "is_approved" = true, "approved_at" = "created_at" WHERE "created_at" < NOW();