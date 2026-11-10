CREATE TABLE "moderation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_username" text,
	"target_id" integer,
	"target_username" text,
	"action" text NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"kind" text NOT NULL,
	"post_id" integer,
	"post_content" text,
	"category" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer,
	"resolution_note" text,
	CONSTRAINT "reports_kind_check" CHECK ("reports"."kind" IN ('post', 'profile')),
	CONSTRAINT "reports_status_check" CHECK ("reports"."status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_log_target_id" ON "moderation_log" USING btree ("target_id","id");--> statement-breakpoint
CREATE INDEX "moderation_log_actor_id" ON "moderation_log" USING btree ("actor_id","id");--> statement-breakpoint
CREATE INDEX "reports_status_id" ON "reports" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "reports_target_id" ON "reports" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "reports_post_id" ON "reports" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "users_banned_until" ON "users" USING btree ("banned_until") WHERE "users"."banned_until" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_muted_until" ON "users" USING btree ("muted_until") WHERE "users"."muted_until" IS NOT NULL;