ALTER TABLE "cases" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "submitted_to_uk_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "submission_threshold" integer;--> statement-breakpoint
-- The author is the first confirmer, including cases created before this rule.
INSERT INTO "case_confirmations" ("case_id", "user_id")
SELECT "id", "author_id" FROM "cases" ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Old registered cases without enough confirmations return to collection.
INSERT INTO "case_status_history" ("case_id", "from_status", "to_status", "actor_id", "comment")
SELECT c."id", 'registered', 'draft', c."author_id", 'Собираем подтверждения жителей перед отправкой в УК'
FROM "cases" c
WHERE c."status" = 'registered' AND
  (SELECT count(*) FROM "case_confirmations" cf WHERE cf."case_id" = c."id") <
  greatest(2, ceil((SELECT count(*) FROM "house_members" hm WHERE hm."house_id" = c."house_id") / 10.0));
--> statement-breakpoint
UPDATE "cases" c SET "status" = 'draft', "version" = "version" + 1, "updated_at" = now(),
  "deadline_policy_key" = NULL, "deadline_started_at" = NULL, "deadline_due_at" = NULL, "deadline_stopped_at" = NULL
WHERE c."status" = 'registered' AND
  (SELECT count(*) FROM "case_confirmations" cf WHERE cf."case_id" = c."id") <
  greatest(2, ceil((SELECT count(*) FROM "house_members" hm WHERE hm."house_id" = c."house_id") / 10.0));
--> statement-breakpoint
-- Work already accepted by the UK keeps its delivery history and control clock.
UPDATE "cases" c SET "submitted_to_uk_at" = coalesce(c."deadline_started_at", c."created_at"),
  "submission_threshold" = greatest(2, ceil((SELECT count(*) FROM "house_members" hm WHERE hm."house_id" = c."house_id") / 10.0))
WHERE c."status" <> 'draft';
--> statement-breakpoint
UPDATE "cases" SET "deadline_policy_key" = NULL, "deadline_started_at" = NULL,
  "deadline_due_at" = NULL, "deadline_stopped_at" = NULL WHERE "status" = 'draft';
