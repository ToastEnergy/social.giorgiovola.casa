ALTER TABLE "group_messages" ADD COLUMN "image_sizes" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "image_sizes" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "image_sizes" jsonb;