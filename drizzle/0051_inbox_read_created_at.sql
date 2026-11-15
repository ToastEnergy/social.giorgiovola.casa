DROP INDEX "inbox_created_at";--> statement-breakpoint
CREATE INDEX "inbox_read_created_at" ON "inbox" USING btree ("created_at") WHERE "inbox"."read_at" IS NOT NULL;