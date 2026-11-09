CREATE INDEX "link_previews_image" ON "link_previews" USING btree ("image");--> statement-breakpoint
CREATE INDEX "link_previews_fetched_at" ON "link_previews" USING btree ("fetched_at");