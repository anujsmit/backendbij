CREATE TYPE "public"."location_source" AS ENUM('gps', 'drag');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('pending', 'assigned', 'canceled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('electrician', 'plumber');--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "service_type" NOT NULL,
	"lat" numeric(10, 6) NOT NULL,
	"lng" numeric(10, 6) NOT NULL,
	"address" text NOT NULL,
	"source" "location_source" NOT NULL,
	"status" "service_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;