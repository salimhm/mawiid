-- CreateTable
CREATE TABLE "room" (
    "room_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "room_uid" TEXT NOT NULL,
    "room_title" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "room_status" TEXT NOT NULL,
    "room_visibility" TEXT NOT NULL,
    "room_max_participants" INTEGER NOT NULL,
    "room_locked" BOOLEAN NOT NULL DEFAULT false,
    "room_lobby_enabled" BOOLEAN NOT NULL DEFAULT false,
    "room_translation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "room_recording_allowed" BOOLEAN NOT NULL DEFAULT false,
    "room_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "room_scheduled_at" DATETIME,
    "room_started_at" DATETIME,
    "room_closed_at" DATETIME,
    "room_close_reason" TEXT,
    "user_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "room_member" (
    "room_member_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "room_member_role" TEXT NOT NULL,
    "room_member_status" TEXT NOT NULL,
    "room_member_banned_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "room_member_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room" ("room_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit" (
    "audit_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "room_id" INTEGER,
    "user_id" INTEGER,
    "audit_action" TEXT NOT NULL,
    "audit_target" TEXT NOT NULL,
    "audit_metadata" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE INDEX "room_status_idx" ON "room"("room_status");

-- CreateIndex
CREATE INDEX "room_user_id_idx" ON "room"("user_id");

-- CreateIndex
CREATE INDEX "room_deleted_at_idx" ON "room"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_uid_idx" ON "room"("room_uid");

-- CreateIndex
CREATE INDEX "room_member_user_id_idx" ON "room_member"("user_id");

-- CreateIndex
CREATE INDEX "room_member_banned_at_idx" ON "room_member"("room_member_banned_at");

-- CreateIndex
CREATE INDEX "room_member_deleted_at_idx" ON "room_member"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_member_room_id_user_id_idx" ON "room_member"("room_id", "user_id") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "audit_room_id_idx" ON "audit"("room_id");

-- CreateIndex
CREATE INDEX "audit_action_idx" ON "audit"("audit_action");

-- CreateIndex
CREATE INDEX "audit_created_at_idx" ON "audit"("created_at");

-- CreateIndex
CREATE INDEX "audit_deleted_at_idx" ON "audit"("deleted_at");

