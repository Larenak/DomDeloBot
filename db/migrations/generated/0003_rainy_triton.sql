ALTER TABLE "house_members" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "house_members" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "houses" ADD COLUMN "normalized_address" text;--> statement-breakpoint
UPDATE "houses" SET "normalized_address" = 'legacy|' || "id"::text WHERE "normalized_address" IS NULL;--> statement-breakpoint
ALTER TABLE "houses" ALTER COLUMN "normalized_address" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_house_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "houses_normalized_address_unique" ON "houses" USING btree ("normalized_address");
