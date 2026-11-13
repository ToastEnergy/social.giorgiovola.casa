CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"inviter_id" integer,
	"by_staff" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by" integer,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invites_code_unique" UNIQUE("code"),
	CONSTRAINT "invites_used_by_unique" UNIQUE("used_by")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invites" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_inviter_id" ON "invites" USING btree ("inviter_id","id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invites_check" CHECK ("users"."invites" >= 0);