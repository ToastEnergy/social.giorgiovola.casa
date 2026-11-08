CREATE INDEX "group_messages_images" ON "group_messages" USING gin ("images");--> statement-breakpoint
CREATE INDEX "messages_images" ON "messages" USING gin ("images");