CREATE TABLE "push_devices" (
	"session_token" text NOT NULL,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_session_token_token_pk" PRIMARY KEY("session_token","token")
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_token_sessions_token_fk" FOREIGN KEY ("session_token") REFERENCES "public"."sessions"("token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_token" ON "push_devices" USING btree ("token");