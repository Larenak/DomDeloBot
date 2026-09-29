CREATE TABLE "house_invites" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"house_id" uuid NOT NULL,
	"max_user_id" bigint NOT NULL,
	"role" "user_role" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "house_invites" ADD CONSTRAINT "house_invites_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_invites" ADD CONSTRAINT "house_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "house_invites_target_idx" ON "house_invites" USING btree ("max_user_id","expires_at");