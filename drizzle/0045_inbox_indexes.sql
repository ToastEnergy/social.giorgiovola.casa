CREATE INDEX "inbox_post_id" ON "inbox" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "inbox_unread" ON "inbox" USING btree ("user_id") WHERE "inbox"."read_at" IS NULL;