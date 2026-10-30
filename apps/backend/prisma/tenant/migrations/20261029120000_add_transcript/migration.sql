-- CreateTable
CREATE TABLE "transcript" (
    "transcript_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "room_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "transcript_segment_id" TEXT NOT NULL,
    "transcript_language" TEXT NOT NULL,
    "transcript_text" TEXT NOT NULL,
    "transcript_started_ms" INTEGER NOT NULL,
    "transcript_ended_ms" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "transcript_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "room" ("room_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "translation" (
    "translation_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transcript_id" INTEGER NOT NULL,
    "translation_language" TEXT NOT NULL,
    "translation_text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "translation_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "transcript" ("transcript_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "transcript_user_id_idx" ON "transcript"("user_id");

-- CreateIndex
CREATE INDEX "transcript_deleted_at_idx" ON "transcript"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_room_id_segment_id_idx" ON "transcript"("room_id", "transcript_segment_id");

-- CreateIndex
CREATE INDEX "translation_deleted_at_idx" ON "translation"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "translation_transcript_id_language_idx" ON "translation"("transcript_id", "translation_language");

