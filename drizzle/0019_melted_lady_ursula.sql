CREATE TABLE "service_request_platform_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"platform_service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_request_platform_services" ADD CONSTRAINT "service_request_platform_services_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_platform_services" ADD CONSTRAINT "service_request_platform_services_platform_service_id_platform_services_id_fk" FOREIGN KEY ("platform_service_id") REFERENCES "public"."platform_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "srps_request_id_idx" ON "service_request_platform_services" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "srps_platform_service_id_idx" ON "service_request_platform_services" USING btree ("platform_service_id");