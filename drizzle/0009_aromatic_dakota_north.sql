CREATE TABLE "phone_change_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"old_phone_number" varchar(20),
	"new_phone_number" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phone_change_attempts" ADD CONSTRAINT "phone_change_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_change_attempts_user_id_idx" ON "phone_change_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "phone_change_attempts_created_at_idx" ON "phone_change_attempts" USING btree ("created_at");