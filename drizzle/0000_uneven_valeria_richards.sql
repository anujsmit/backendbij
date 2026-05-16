CREATE TYPE "public"."user_role" AS ENUM('user', 'mistri', 'admin');--> statement-breakpoint
CREATE TABLE "mistri_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"bio" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"current_location" text,
	"average_rating" numeric(3, 2) DEFAULT '0.00',
	"jobs_completed" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(256) NOT NULL,
	"otp" varchar(6) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_name" varchar(100) NOT NULL,
	"description" text,
	"map_icon_color" varchar(7),
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "services_service_name_unique" UNIQUE("service_name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"profile_image_url" text,
	"role" "user_role",
	"is_active" boolean DEFAULT true NOT NULL,
	"device_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"role_selected_at" timestamp with time zone,
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD CONSTRAINT "mistri_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD CONSTRAINT "mistri_profiles_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;