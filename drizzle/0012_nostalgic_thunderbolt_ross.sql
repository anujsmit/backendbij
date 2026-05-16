ALTER TABLE "service_requests" ADD COLUMN "customer_notes" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "prefer_call_explanation" boolean DEFAULT false NOT NULL;