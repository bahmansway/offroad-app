CREATE TABLE "clan_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"car_id" uuid,
	"seats" smallint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "event_participants_event_id_user_id_pk" PRIMARY KEY("event_id","user_id"),
	CONSTRAINT "event_participants_status_check" CHECK ("event_participants"."status" in ('going','waitlist','removed')),
	CONSTRAINT "event_participants_seats_check" CHECK ("event_participants"."seats" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"spot_id" uuid,
	"meeting_lat" double precision,
	"meeting_lng" double precision,
	"meeting_label" text,
	"max_cars" integer NOT NULL,
	"min_difficulty" smallint,
	"requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"clan_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cover_image_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_max_cars_check" CHECK ("events"."max_cars" between 2 and 100),
	CONSTRAINT "events_visibility_check" CHECK ("events"."visibility" in ('public','clan')),
	CONSTRAINT "events_status_check" CHECK ("events"."status" in ('scheduled','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_type_check";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "muted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_by_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "system_params" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clan_invites" ADD CONSTRAINT "clan_invites_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_invites" ADD CONSTRAINT "clan_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_invites" ADD CONSTRAINT "clan_invites_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_image_id_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clan_invites_clan_user_idx" ON "clan_invites" USING btree ("clan_id","user_id");--> statement-breakpoint
CREATE INDEX "clan_invites_user_idx" ON "clan_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_participants_user_idx" ON "event_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_participants_event_status_idx" ON "event_participants" USING btree ("event_id","status","joined_at");--> statement-breakpoint
CREATE INDEX "events_starts_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer_id","created_at");--> statement-breakpoint
CREATE INDEX "events_spot_idx" ON "events" USING btree ("spot_id");--> statement-breakpoint
CREATE INDEX "events_clan_idx" ON "events" USING btree ("clan_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pinned_message_id_messages_id_fk" FOREIGN KEY ("pinned_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pinned_by_id_users_id_fk" FOREIGN KEY ("pinned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_event_idx" ON "conversations" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_type_check" CHECK (("conversations"."type" = 'dm' and "conversations"."dm_key" is not null and "conversations"."clan_id" is null and "conversations"."event_id" is null) or ("conversations"."type" = 'clan' and "conversations"."clan_id" is not null and "conversations"."dm_key" is null and "conversations"."event_id" is null) or ("conversations"."type" = 'event' and "conversations"."event_id" is not null and "conversations"."dm_key" is null and "conversations"."clan_id" is null));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_type_check" CHECK (("messages"."type" = 'user' and "messages"."sender_id" is not null) or ("messages"."type" = 'system' and "messages"."system_key" is not null));