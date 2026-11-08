CREATE TABLE "link_previews" (
	"url" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"image" text,
	"site_name" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
