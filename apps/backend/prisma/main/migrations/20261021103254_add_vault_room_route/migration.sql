-- AlterTable
ALTER TABLE "user" ADD COLUMN "user_language" TEXT;

-- CreateTable
CREATE TABLE "vault" (
    "vault_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vault_owner_type" TEXT NOT NULL,
    "vault_owner_id" INTEGER NOT NULL,
    "vault_database_url" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "room_route" (
    "room_route_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "room_uid" TEXT NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME,
    CONSTRAINT "room_route_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vault" ("vault_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "vault_deleted_at_idx" ON "vault"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "vault_owner_type_owner_id_idx" ON "vault"("vault_owner_type", "vault_owner_id") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "room_route_vault_id_idx" ON "room_route"("vault_id");

-- CreateIndex
CREATE INDEX "room_route_deleted_at_idx" ON "room_route"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_route_room_uid_idx" ON "room_route"("room_uid");
