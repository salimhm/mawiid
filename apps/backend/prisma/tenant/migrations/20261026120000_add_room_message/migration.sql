-- CreateTable
CREATE TABLE "message" (
    "message_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "message_client_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "message_file_ids" JSONB NOT NULL DEFAULT '[]',
    "message_reply_to_id" INTEGER,
    "message_edited_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "message_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room" ("room_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "message_room_id_user_id_message_client_id_idx" ON "message"("room_id", "user_id", "message_client_id");

-- CreateIndex
CREATE INDEX "message_room_id_deleted_at_message_id_idx" ON "message"("room_id", "deleted_at", "message_id");

-- CreateIndex
CREATE INDEX "message_user_id_idx" ON "message"("user_id");

-- CreateIndex
CREATE INDEX "message_reply_to_id_idx" ON "message"("message_reply_to_id");

-- CreateIndex
CREATE INDEX "message_deleted_at_idx" ON "message"("deleted_at");
