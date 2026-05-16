-- Add customer notes and prefer call explanation fields to service_requests table
ALTER TABLE "service_requests" ADD COLUMN "customer_notes" text;
ALTER TABLE "service_requests" ADD COLUMN "prefer_call_explanation" boolean DEFAULT false NOT NULL;
