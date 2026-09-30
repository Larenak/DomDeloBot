ALTER TABLE "cases" ADD COLUMN "deadline_policy_key" text;
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deadline_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deadline_due_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deadline_stopped_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "cases" SET
  "deadline_policy_key" = CASE "category"
    WHEN 'lighting' THEN 'lighting-7d-v1'
    WHEN 'entrance' THEN 'entrance-1d-v1'
    WHEN 'elevator' THEN 'elevator-1d-v1'
    WHEN 'water' THEN 'water-3d-v1'
    WHEN 'heating' THEN 'heating-3d-v1'
    WHEN 'yard' THEN 'yard-elapsed-v1'
    WHEN 'other' THEN 'other-elapsed-v1'
    ELSE NULL
  END,
  "deadline_started_at" = "created_at",
  "deadline_due_at" = CASE "category"
    WHEN 'lighting' THEN "created_at" + interval '7 days'
    WHEN 'entrance' THEN "created_at" + interval '1 day'
    WHEN 'elevator' THEN "created_at" + interval '1 day'
    WHEN 'water' THEN "created_at" + interval '3 days'
    WHEN 'heating' THEN "created_at" + interval '3 days'
    ELSE NULL
  END,
  "deadline_stopped_at" = CASE
    WHEN "status" IN ('awaiting_resident_verification', 'resolved') THEN coalesce(
      (SELECT max(history."created_at") FROM "case_status_history" AS history
       WHERE history."case_id" = "cases"."id"
         AND history."to_status" = 'awaiting_resident_verification'),
      "updated_at"
    )
    ELSE NULL
  END;
