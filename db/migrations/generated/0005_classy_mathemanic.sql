ALTER TYPE "public"."user_role" ADD VALUE 'owner' BEFORE 'dispatcher';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'tenant' BEFORE 'dispatcher';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'chair' BEFORE 'dispatcher';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'authority' BEFORE 'admin';--> statement-breakpoint
CREATE TABLE "house_role_grants" (
	"house_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "house_role_grants_house_id_user_id_pk" PRIMARY KEY("house_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_deliveries" (
	"event_id" uuid NOT NULL,
	"max_chat_id" bigint NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_deliveries_event_id_max_chat_id_pk" PRIMARY KEY("event_id","max_chat_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_poll_id_user_id_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "polls" RENAME COLUMN "closed_at" TO "closes_at";--> statement-breakpoint
ALTER TABLE "polls" DROP CONSTRAINT "polls_case_id_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "polls" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "case_status_history" ADD COLUMN "planned_completion_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "planned_completion_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "house_id" uuid;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "created_by" uuid;--> statement-breakpoint
UPDATE "polls" SET "house_id" = "cases"."house_id", "created_by" = "cases"."author_id" FROM "cases" WHERE "polls"."case_id" = "cases"."id";--> statement-breakpoint
UPDATE "polls" SET "closes_at" = COALESCE("closes_at", "created_at" + interval '7 days');--> statement-breakpoint
ALTER TABLE "polls" ALTER COLUMN "house_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "polls" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "polls" ALTER COLUMN "closes_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "house_role_grants" ADD CONSTRAINT "house_role_grants_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_role_grants" ADD CONSTRAINT "house_role_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_deliveries_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;