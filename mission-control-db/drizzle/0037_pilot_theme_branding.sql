-- Spec 2026-10-09 §8.1 (Mission Pilot theming, P3): a work center's Pilot theme override
-- (NULL = inherit from the parent chain and the site) and the brand_asset table P3b's logos
-- fill. Behaviour-neutral: every existing work center reads NULL, so every Pilot keeps the
-- site theme; brand_asset starts empty.
CREATE TABLE "brand_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data_base64" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_asset_mime_ck" CHECK ("brand_asset"."mime" in ('image/svg+xml','image/png')),
	CONSTRAINT "brand_asset_id_ck" CHECK ("brand_asset"."id" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "work_center" ADD COLUMN "pilot_theme" jsonb;