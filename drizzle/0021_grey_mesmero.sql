CREATE TABLE "hero_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255),
	"subtitle" text,
	"image_url" text NOT NULL,
	"link_url" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hero_banners_display_order_idx" ON "hero_banners" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "hero_banners_is_active_idx" ON "hero_banners" USING btree ("is_active");