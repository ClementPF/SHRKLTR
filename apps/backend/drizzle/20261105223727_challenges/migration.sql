CREATE TYPE "challenge_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tournament_id" uuid NOT NULL,
	"challenger_user_id" uuid NOT NULL,
	"opponent_user_id" uuid NOT NULL,
	"pair_low_user_id" uuid NOT NULL,
	"pair_high_user_id" uuid NOT NULL,
	"status" "challenge_status" DEFAULT 'PENDING'::"challenge_status" NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"expiring_notified_at" timestamp with time zone,
	"game_id" uuid,
	"winner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_distinct_players_check" CHECK ("challenger_user_id" <> "opponent_user_id"),
	CONSTRAINT "challenges_canonical_pair_check" CHECK ("pair_low_user_id" = least("challenger_user_id", "opponent_user_id") and "pair_high_user_id" = greatest("challenger_user_id", "opponent_user_id")),
	CONSTRAINT "challenges_deadline_check" CHECK ("deadline_at" > "created_at"),
	CONSTRAINT "challenges_accepted_at_check" CHECK ("status" not in ('ACCEPTED', 'COMPLETED') or "accepted_at" is not null),
	CONSTRAINT "challenges_resolved_at_check" CHECK (("status" in ('PENDING', 'ACCEPTED')) = ("resolved_at" is null)),
	CONSTRAINT "challenges_completed_winner_check" CHECK ("status" <> 'COMPLETED' or "winner_user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "challenge_id" uuid;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD COLUMN "source_challenge_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_active_pair_unique" ON "challenges" ("tournament_id","pair_low_user_id","pair_high_user_id") WHERE "status" in ('PENDING', 'ACCEPTED');--> statement-breakpoint
CREATE INDEX "challenges_status_deadline_idx" ON "challenges" ("status","deadline_at","id");--> statement-breakpoint
CREATE INDEX "challenges_challenger_created_idx" ON "challenges" ("challenger_user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "challenges_opponent_created_idx" ON "challenges" ("opponent_user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_tournament_id_tournaments_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_challenger_user_id_users_id_fkey" FOREIGN KEY ("challenger_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_opponent_user_id_users_id_fkey" FOREIGN KEY ("opponent_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_winner_user_id_users_id_fkey" FOREIGN KEY ("winner_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_challenge_id_challenges_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_source_challenge_id_challenges_id_fkey" FOREIGN KEY ("source_challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL;