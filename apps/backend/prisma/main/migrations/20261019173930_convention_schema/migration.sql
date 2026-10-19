/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "User";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "organization" (
    "organization_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "department" (
    "department_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" INTEGER NOT NULL,
    "department_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "department_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization" ("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user" (
    "user_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_phone" TEXT NOT NULL,
    "user_first_name" TEXT NOT NULL,
    "user_last_name" TEXT NOT NULL,
    "user_image" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "member" (
    "member_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "member_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department" ("department_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "organization_name_idx" ON "organization"("organization_name");

-- CreateIndex
CREATE INDEX "organization_deleted_at_idx" ON "organization"("deleted_at");

-- CreateIndex
CREATE INDEX "department_organization_id_idx" ON "department"("organization_id");

-- CreateIndex
CREATE INDEX "department_name_idx" ON "department"("department_name");

-- CreateIndex
CREATE INDEX "department_deleted_at_idx" ON "department"("deleted_at");

-- CreateIndex
CREATE INDEX "user_first_name_idx" ON "user"("user_first_name");

-- CreateIndex
CREATE INDEX "user_last_name_idx" ON "user"("user_last_name");

-- CreateIndex
CREATE INDEX "user_deleted_at_idx" ON "user"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_idx" ON "user"("user_phone") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "member_department_id_idx" ON "member"("department_id");

-- CreateIndex
CREATE INDEX "member_deleted_at_idx" ON "member"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_user_id_department_id_idx" ON "member"("user_id", "department_id") WHERE "deleted_at" IS NULL;
