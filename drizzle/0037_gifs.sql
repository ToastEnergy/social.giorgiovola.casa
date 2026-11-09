ALTER TABLE "group_messages" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "gif" jsonb;