CREATE TABLE "chat_management_checks" (
	"max_chat_id" bigint PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone,
	"announced_revision" integer DEFAULT 0 NOT NULL,
	"presence" text,
	"missing_notice_id" text,
	"previous_removed_revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "house_management" (
	"house_id" uuid PRIMARY KEY NOT NULL,
	"organization_name" text,
	"service_max_user_id" bigint,
	"previous_service_max_user_id" bigint,
	"revision" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_management_checks" ADD CONSTRAINT "chat_management_checks_max_chat_id_chat_bindings_max_chat_id_fk" FOREIGN KEY ("max_chat_id") REFERENCES "public"."chat_bindings"("max_chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_management" ADD CONSTRAINT "house_management_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;