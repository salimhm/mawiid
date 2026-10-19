/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "User";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "file" (
    "file_id" TEXT NOT NULL PRIMARY KEY,
    "file_name" TEXT,
    "user_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "access" (
    "access_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "actions" JSONB NOT NULL DEFAULT [],
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateIndex
CREATE INDEX "file_deleted_at_idx" ON "file"("deleted_at");

-- CreateIndex
CREATE INDEX "access_deleted_at_idx" ON "access"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_user_id_idx" ON "access"("user_id") WHERE "deleted_at" IS NULL;
