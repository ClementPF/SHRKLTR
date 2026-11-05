CREATE TYPE "notification_category" AS ENUM('games', 'challenges', 'achievements', 'claims', 'groups');--> statement-breakpoint
CREATE TYPE "notification_type" AS ENUM('game_recorded', 'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_expiring', 'challenge_expired', 'achievement_unlocked', 'placeholder_claimed', 'group_member_joined');--> statement-breakpoint
CREATE TYPE "push_platform" AS ENUM('IOS', 'ANDROID', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY,
	"games_enabled" boolean DEFAULT true NOT NULL,
	"challenges_enabled" boolean DEFAULT true NOT NULL,
	"achievements_enabled" boolean DEFAULT true NOT NULL,
	"claims_enabled" boolean DEFAULT true NOT NULL,
	"groups_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipient_user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"type" "notification_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"actor_user_id" uuid,
	"subject_user_id" uuid,
	"game_id" uuid,
	"achievement_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_recipient_dedupe_unique" UNIQUE("recipient_user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"expo_token" text NOT NULL UNIQUE,
	"platform" "push_platform" DEFAULT 'UNKNOWN'::"push_platform" NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_user_installation_unique" UNIQUE("user_id","installation_id"),
	CONSTRAINT "push_devices_installation_id_length_check" CHECK (char_length("installation_id") between 1 and 200)
);
--> statement-breakpoint
-- Data migration (hand-added): move legacy single tokens into push_devices before dropping the
-- column. A token shared by several users goes to the most recently updated one (ties by id).
INSERT INTO "push_devices" ("user_id", "installation_id", "expo_token", "platform", "last_seen_at")
SELECT DISTINCT ON (btrim("push_token")) "id", 'legacy:' || "id", btrim("push_token"), 'UNKNOWN', "updated_at"
FROM "users"
WHERE "push_token" IS NOT NULL AND btrim("push_token") <> ''
ORDER BY btrim("push_token"), "updated_at" DESC, "id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "push_token";--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" ("recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" ("recipient_user_id") WHERE "read_at" is null;--> statement-breakpoint
CREATE INDEX "push_devices_active_user_idx" ON "push_devices" ("user_id") WHERE "disabled_at" is null;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_user_id_users_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;