CREATE TABLE "mistri_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mistri_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"needs_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"mistri_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"review" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_service_request_id_unique" UNIQUE("service_request_id")
);
--> statement-breakpoint
CREATE TABLE "service_request_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_request_id" uuid NOT NULL,
	"mistri_service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mistri_services" ADD CONSTRAINT "mistri_services_mistri_id_users_id_fk" FOREIGN KEY ("mistri_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_mistri_id_users_id_fk" FOREIGN KEY ("mistri_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_services" ADD CONSTRAINT "service_request_services_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_services" ADD CONSTRAINT "service_request_services_mistri_service_id_mistri_services_id_fk" FOREIGN KEY ("mistri_service_id") REFERENCES "public"."mistri_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mistri_services_mistri_id_idx" ON "mistri_services" USING btree ("mistri_id");--> statement-breakpoint
CREATE INDEX "mistri_services_is_active_idx" ON "mistri_services" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "ratings_mistri_id_idx" ON "ratings" USING btree ("mistri_id");--> statement-breakpoint
CREATE INDEX "ratings_customer_id_idx" ON "ratings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ratings_request_id_idx" ON "ratings" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "service_request_services_request_id_idx" ON "service_request_services" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "service_request_services_service_id_idx" ON "service_request_services" USING btree ("mistri_service_id");