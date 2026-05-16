ALTER TABLE "service_requests" ADD COLUMN "payment_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "paid_at" timestamp with time zone;