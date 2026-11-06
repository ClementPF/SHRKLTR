CREATE TYPE "group_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "group_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"group_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"token_hash" text NOT NULL UNIQUE,
	"code_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid,
	"user_id" uuid,
	"role" "group_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_players" (
	"group_id" uuid,
	"placeholder_user_id" uuid,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_players_pk" PRIMARY KEY("group_id","placeholder_user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_length_check" CHECK (char_length("name") between 1 and 100 and "name" = btrim("name"))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD COLUMN "source_group_id" uuid;--> statement-breakpoint
CREATE INDEX "group_invites_group_created_idx" ON "group_invites" ("group_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "group_members_user_group_idx" ON "group_members" ("user_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_owner_unique" ON "group_members" ("group_id") WHERE "role" = 'OWNER';--> statement-breakpoint
CREATE INDEX "group_players_placeholder_group_idx" ON "group_players" ("placeholder_user_id","group_id");--> statement-breakpoint
CREATE INDEX "tournaments_group_created_idx" ON "tournaments" ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_players" ADD CONSTRAINT "group_players_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_players" ADD CONSTRAINT "group_players_placeholder_user_id_users_id_fkey" FOREIGN KEY ("placeholder_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_players" ADD CONSTRAINT "group_players_added_by_user_id_users_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_source_group_id_groups_id_fkey" FOREIGN KEY ("source_group_id") REFERENCES "groups"("id") ON DELETE SET NULL;