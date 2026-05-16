CREATE TYPE "public"."sms_type" AS ENUM('otp_login', 'otp_phone_change', 'otp_account_deletion', 'otp_admin', 'service_accepted', 'service_completed');--> statement-breakpoint
CREATE TABLE "sms_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" varchar(20) NOT NULL,
	"type" "sms_type" NOT NULL,
	"status" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sms_logs_type_idx" ON "sms_logs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sms_logs_status_idx" ON "sms_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sms_logs_created_at_idx" ON "sms_logs" USING btree ("created_at");