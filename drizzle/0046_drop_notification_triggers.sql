-- notifications are created by src/lib/server/notify.ts since the previous release, which still
-- ran these triggers next to it (blue-green). Only safe once that release is in production: an
-- older version relies on the triggers alone.
DROP TRIGGER IF EXISTS posts_notification ON posts;--> statement-breakpoint
DROP TRIGGER IF EXISTS posts_quote_notification ON posts;--> statement-breakpoint
DROP TRIGGER IF EXISTS likes_notification ON likes;--> statement-breakpoint
DROP TRIGGER IF EXISTS follows_notification ON follows;--> statement-breakpoint
DROP TRIGGER IF EXISTS regiorgs_notification ON regiorgs;--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_posts();--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_quote();--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_like();--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_follow();--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_regiorg();
