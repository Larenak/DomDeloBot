ALTER TABLE "houses" ADD COLUMN "fias_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "houses_fias_id_unique" ON "houses" USING btree ("fias_id");