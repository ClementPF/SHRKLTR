CREATE TYPE "account_type" AS ENUM('REGISTERED', 'PLACEHOLDER');--> statement-breakpoint
CREATE TABLE "app_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"creator_user_id" uuid NOT NULL UNIQUE,
	"token_hash" text NOT NULL UNIQUE,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"placeholder_user_id" uuid NOT NULL UNIQUE,
	"creator_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_claims_not_consumed_and_revoked_check" CHECK ("consumed_at" is null or "revoked_at" is null)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_type" "account_type" DEFAULT 'REGISTERED'::"account_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "google_sub" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "player_claims_creator_created_idx" ON "player_claims" ("creator_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "users_created_by_account_type_idx" ON "users" ("created_by_user_id","account_type");--> statement-breakpoint
ALTER TABLE "app_invites" ADD CONSTRAINT "app_invites_creator_user_id_users_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "player_claims" ADD CONSTRAINT "player_claims_placeholder_user_id_users_id_fkey" FOREIGN KEY ("placeholder_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "player_claims" ADD CONSTRAINT "player_claims_creator_user_id_users_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_identity_check" CHECK (("account_type" = 'PLACEHOLDER' and "google_sub" is null and "email" is null and "claimed_at" is null and "email_verified" = false) or ("account_type" = 'REGISTERED' and "google_sub" is not null));