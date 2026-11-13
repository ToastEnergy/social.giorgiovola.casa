ALTER TABLE "inbox" DROP CONSTRAINT "inbox_type_check";--> statement-breakpoint
ALTER TABLE "inbox" ADD COLUMN "invites" integer;--> statement-breakpoint
ALTER TABLE "inbox" ADD CONSTRAINT "inbox_type_check" CHECK ("inbox"."type" IN ('mention', 'reply', 'like', 'ratio', 'ratioed_by_you', 'follow', 'regiorg', 'quote', 'invites'));