CREATE TYPE "public"."mistri_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD COLUMN "experience_level" varchar(50);--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD COLUMN "govt_id_type" varchar(50);--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD COLUMN "govt_id_front_url" text;--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD COLUMN "govt_id_back_url" text;--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD COLUMN "approval_status" "mistri_approval_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "mistri_profiles" ADD COLUMN "approval_rejection_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_location" text;