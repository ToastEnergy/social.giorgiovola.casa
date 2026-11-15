ALTER TABLE "group_messages" ADD COLUMN "audio" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio_played_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "audio" jsonb;--> statement-breakpoint
CREATE INDEX "group_messages_audio_url" ON "group_messages" USING btree (("audio"->>'url')) WHERE "group_messages"."audio" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_audio_url" ON "messages" USING btree (("audio"->>'url')) WHERE "messages"."audio" IS NOT NULL;