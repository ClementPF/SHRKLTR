CREATE TYPE "achievement_source" AS ENUM('GAME', 'CHALLENGE', 'GROUP', 'CLAIM', 'BACKFILL');--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid,
	"achievement_code" text,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" "achievement_source" NOT NULL,
	"source_game_id" uuid,
	CONSTRAINT "user_achievements_pk" PRIMARY KEY("user_id","achievement_code"),
	CONSTRAINT "user_achievements_code_check" CHECK (achievement_code in ('first_win', 'win_streak_3', 'win_streak_5', 'win_streak_10', 'games_10', 'games_50', 'games_100', 'giant_killer', 'explorer_3', 'explorer_5', 'first_challenge_won', 'first_group_joined', 'invited_player_claimed'))
);
--> statement-breakpoint
CREATE INDEX "user_achievements_user_unlocked_idx" ON "user_achievements" ("user_id","unlocked_at" DESC NULLS LAST,"achievement_code");--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_source_game_id_games_id_fkey" FOREIGN KEY ("source_game_id") REFERENCES "games"("id") ON DELETE SET NULL;