CREATE TABLE "followers_seen" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follows_not_self" CHECK ("follows"."follower_id" <> "follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "post_photos" (
	"post_id" uuid NOT NULL,
	"idx" smallint NOT NULL,
	"image_id" uuid NOT NULL,
	CONSTRAINT "post_photos_post_id_idx_pk" PRIMARY KEY("post_id","idx"),
	CONSTRAINT "post_photos_idx_check" CHECK ("post_photos"."idx" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "post_saves" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "post_saves_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"car_id" uuid,
	"spot_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "social" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "followers_seen" ADD CONSTRAINT "followers_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_photos" ADD CONSTRAINT "post_photos_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_photos" ADD CONSTRAINT "post_photos_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_saves" ADD CONSTRAINT "post_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_followee_created_idx" ON "follows" USING btree ("followee_id","created_at" DESC NULLS LAST,"follower_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follows_follower_created_idx" ON "follows" USING btree ("follower_id","created_at" DESC NULLS LAST,"followee_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "post_comments_post_created_idx" ON "post_comments" USING btree ("post_id","created_at","id");--> statement-breakpoint
CREATE INDEX "post_comments_author_idx" ON "post_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "post_likes_user_idx" ON "post_likes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_photos_image_idx" ON "post_photos" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "post_saves_user_created_idx" ON "post_saves" USING btree ("user_id","created_at" DESC NULLS LAST,"post_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_published_created_idx" ON "posts" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."published_at" is not null;--> statement-breakpoint
CREATE INDEX "posts_author_created_idx" ON "posts" USING btree ("author_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_spot_created_idx" ON "posts" USING btree ("spot_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."spot_id" is not null;--> statement-breakpoint
CREATE INDEX "posts_car_created_idx" ON "posts" USING btree ("car_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."car_id" is not null;--> statement-breakpoint
CREATE INDEX "posts_drafts_idx" ON "posts" USING btree ("created_at") WHERE "posts"."published_at" is null;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_post_idx" ON "images" USING btree ("post_id") WHERE "images"."post_id" is not null;--> statement-breakpoint
-- v6 data: friends become mutual follows, pending friend requests become a follow from the requester.
-- Idempotent (ON CONFLICT DO NOTHING); pairs with a block either way are skipped.
INSERT INTO "follows" ("follower_id", "followee_id", "created_at")
SELECT f."user_id", f."friend_id", date_trunc('milliseconds', f."created_at") FROM "friendships" f
WHERE NOT EXISTS (SELECT 1 FROM "blocks" b WHERE (b."blocker_id" = f."user_id" AND b."blocked_id" = f."friend_id") OR (b."blocker_id" = f."friend_id" AND b."blocked_id" = f."user_id"))
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "follows" ("follower_id", "followee_id", "created_at")
SELECT r."from_id", r."to_id", date_trunc('milliseconds', r."created_at") FROM "friend_requests" r
WHERE r."declined_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "blocks" b WHERE (b."blocker_id" = r."from_id" AND b."blocked_id" = r."to_id") OR (b."blocker_id" = r."to_id" AND b."blocked_id" = r."from_id"))
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- existing users start with "seen" = now, so the migrated follows don't all show up as new followers
INSERT INTO "followers_seen" ("user_id", "seen_at") SELECT u."id", now() FROM "users" u ON CONFLICT DO NOTHING;
