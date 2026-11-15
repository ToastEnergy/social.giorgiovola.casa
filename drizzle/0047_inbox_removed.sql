CREATE TABLE "inbox_removed" (
	"user_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"post_id" integer,
	"type" text NOT NULL,
	"pushed_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "inbox_removed_key" UNIQUE NULLS NOT DISTINCT("user_id","sender_id","post_id","type")
);
--> statement-breakpoint
ALTER TABLE "inbox_removed" ADD CONSTRAINT "inbox_removed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_removed" ADD CONSTRAINT "inbox_removed_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_removed" ADD CONSTRAINT "inbox_removed_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_removed_pushed_at" ON "inbox_removed" USING btree ("pushed_at");