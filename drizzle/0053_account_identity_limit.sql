ALTER TABLE "users" ADD COLUMN "max_identities" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_max_identities_check" CHECK ("users"."max_identities" >= 0);