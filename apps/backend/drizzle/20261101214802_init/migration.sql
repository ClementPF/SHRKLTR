CREATE TYPE "game_result" AS ENUM('WIN', 'TIE', 'LOSS');--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tournament_id" uuid NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"result" "game_result" NOT NULL,
	"score_value" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"jti" text NOT NULL CONSTRAINT "refresh_tokens_jti_unique" UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rivalry_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"rival_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"best_score" double precision NOT NULL,
	"worst_score" double precision NOT NULL,
	"game_count" integer DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"lose_count" integer DEFAULT 0 NOT NULL,
	"tie_count" integer DEFAULT 0 NOT NULL,
	"win_streak" integer DEFAULT 0 NOT NULL,
	"lose_streak" integer DEFAULT 0 NOT NULL,
	"tie_streak" integer DEFAULT 0 NOT NULL,
	"longuest_win_streak" integer DEFAULT 0 NOT NULL,
	"longuest_lose_streak" integer DEFAULT 0 NOT NULL,
	"longuest_tie_streak" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rivalry_stats_user_rival_tournament_unique" UNIQUE("user_id","rival_id","tournament_id")
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"best_score" double precision NOT NULL,
	"worst_score" double precision NOT NULL,
	"game_count" integer DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"lose_count" integer DEFAULT 0 NOT NULL,
	"tie_count" integer DEFAULT 0 NOT NULL,
	"win_streak" integer DEFAULT 0 NOT NULL,
	"lose_streak" integer DEFAULT 0 NOT NULL,
	"tie_streak" integer DEFAULT 0 NOT NULL,
	"longuest_win_streak" integer DEFAULT 0 NOT NULL,
	"longuest_lose_streak" integer DEFAULT 0 NOT NULL,
	"longuest_tie_streak" integer DEFAULT 0 NOT NULL,
	"best_rivalry_id" uuid,
	"worst_rivalry_id" uuid,
	CONSTRAINT "stats_user_tournament_unique" UNIQUE("user_id","tournament_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"display_name" text NOT NULL,
	"is_over" boolean DEFAULT false NOT NULL,
	"sport_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"google_sub" text NOT NULL UNIQUE,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"first_name" text,
	"last_name" text,
	"username" text NOT NULL UNIQUE,
	"picture_url" text,
	"locale" text,
	"push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "games_tournament_date_idx" ON "games" ("tournament_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outcomes_game_idx" ON "outcomes" ("game_id");--> statement-breakpoint
CREATE INDEX "outcomes_user_idx" ON "outcomes" ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id");--> statement-breakpoint
CREATE INDEX "rivalry_stats_tournament_idx" ON "rivalry_stats" ("tournament_id");--> statement-breakpoint
CREATE INDEX "stats_tournament_idx" ON "stats" ("tournament_id");--> statement-breakpoint
CREATE INDEX "tournaments_sport_idx" ON "tournaments" ("sport_id");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_tournament_id_tournaments_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rivalry_stats" ADD CONSTRAINT "rivalry_stats_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rivalry_stats" ADD CONSTRAINT "rivalry_stats_rival_id_users_id_fkey" FOREIGN KEY ("rival_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rivalry_stats" ADD CONSTRAINT "rivalry_stats_tournament_id_tournaments_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stats" ADD CONSTRAINT "stats_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stats" ADD CONSTRAINT "stats_tournament_id_tournaments_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_sport_id_sports_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id");--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL;