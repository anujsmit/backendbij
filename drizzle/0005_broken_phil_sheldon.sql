ALTER TABLE "service_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "unpaid" boolean DEFAULT false NOT NULL;