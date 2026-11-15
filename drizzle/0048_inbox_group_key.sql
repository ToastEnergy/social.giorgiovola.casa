ALTER TABLE "inbox" ADD COLUMN "group_key" text;--> statement-breakpoint
-- the group keys of the existing likes, regiorgs and follows, as notifications.ts computed them
-- before they were stored (the others stay null: 'n-<id>'). before the indexes, so that they
-- don't keep an entry for every row this updates
UPDATE "inbox" SET "group_key" = CASE
	WHEN "type" IN ('like', 'regiorg')
		THEN "type" || '-' || "post_id" || '-' || to_char("created_at" AT TIME ZONE 'UTC', 'YYYYMMDD')
	ELSE 'follow-' || to_char("created_at" AT TIME ZONE 'UTC', 'YYYYMMDD')
END
WHERE "group_key" IS NULL AND "type" IN ('like', 'regiorg', 'follow');--> statement-breakpoint
CREATE INDEX "inbox_user_created" ON "inbox" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inbox_user_group_key" ON "inbox" USING btree ("user_id","group_key") WHERE "inbox"."group_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inbox_group_key_missing" ON "inbox" USING btree ("user_id") WHERE "inbox"."group_key" IS NULL AND "inbox"."type" IN ('like', 'regiorg', 'follow');