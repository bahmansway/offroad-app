CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "clan_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"clan_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clan_requests" (
	"clan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clan_requests_clan_id_user_id_pk" PRIMARY KEY("clan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "clans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"tag" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"city" text,
	"is_open" boolean DEFAULT true NOT NULL,
	"leader_id" uuid NOT NULL,
	"logo_image_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"clan_id" uuid,
	"dm_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_type_check" CHECK (("conversations"."type" = 'dm' and "conversations"."dm_key" is not null and "conversations"."clan_id" is null) or ("conversations"."type" = 'clan' and "conversations"."clan_id" is not null and "conversations"."dm_key" is null))
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text DEFAULT 'image/jpeg' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"text" text NOT NULL,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "trim_id" text;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "engine_l" double precision;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "hp" integer;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "drive" text;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "transmission" text;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "fuel" text;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "cars" ADD COLUMN "photo_image_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_image_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_car_id" uuid;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_members" ADD CONSTRAINT "clan_members_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_requests" ADD CONSTRAINT "clan_requests_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_requests" ADD CONSTRAINT "clan_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clans" ADD CONSTRAINT "clans_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clans" ADD CONSTRAINT "clans_logo_image_id_images_id_fk" FOREIGN KEY ("logo_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "clan_members_clan_idx" ON "clan_members" USING btree ("clan_id");--> statement-breakpoint
CREATE INDEX "clan_requests_user_idx" ON "clan_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clans_name_key_idx" ON "clans" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "clans_tag_idx" ON "clans" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_clan_idx" ON "conversations" USING btree ("clan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_dm_key_idx" ON "conversations" USING btree ("dm_key");--> statement-breakpoint
CREATE INDEX "images_owner_idx" ON "images" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "messages_conv_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_id_idx" ON "messages" USING btree ("conversation_id","sender_id","client_id");--> statement-breakpoint
ALTER TABLE "cars" ADD CONSTRAINT "cars_photo_image_id_images_id_fk" FOREIGN KEY ("photo_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_image_id_images_id_fk" FOREIGN KEY ("avatar_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_current_car_id_cars_id_fk" FOREIGN KEY ("current_car_id") REFERENCES "public"."cars"("id") ON DELETE set null ON UPDATE no action;