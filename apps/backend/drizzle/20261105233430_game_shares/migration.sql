CREATE TABLE "game_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"game_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"snapshot" jsonb NOT NULL,
	"template_version" integer NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "game_shares_game_creator_created_idx" ON "game_shares" ("game_id","created_by_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "game_shares_active_issuer_unique" ON "game_shares" ("game_id","created_by_user_id") WHERE "revoked_at" is null;--> statement-breakpoint
ALTER TABLE "game_shares" ADD CONSTRAINT "game_shares_game_id_games_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "game_shares" ADD CONSTRAINT "game_shares_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE;