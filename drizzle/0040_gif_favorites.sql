CREATE TABLE "gif_favorites" (
	"user_id" integer NOT NULL,
	"slug" text NOT NULL,
	"gif" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gif_favorites_user_id_slug_pk" PRIMARY KEY("user_id","slug")
);
--> statement-breakpoint
ALTER TABLE "gif_favorites" ADD CONSTRAINT "gif_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gif_favorites_user_id_created_at" ON "gif_favorites" USING btree ("user_id","created_at");