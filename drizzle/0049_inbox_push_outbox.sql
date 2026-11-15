ALTER TABLE "inbox" ADD COLUMN "push_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "push_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- from now on a row without pushed_at is a push the worker sends (src/lib/server/pushOutbox.ts).
-- the existing ones never are: older releases left rows unpushed on purpose (or on a failure),
-- and those from before pushed_at existed have none. before the index, so it starts small
UPDATE "inbox" SET "pushed_at" = "created_at" WHERE "pushed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "inbox_unpushed" ON "inbox" USING btree ("id") WHERE "inbox"."pushed_at" IS NULL;
