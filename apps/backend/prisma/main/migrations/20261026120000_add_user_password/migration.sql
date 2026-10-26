-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user" (
    "user_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_phone" TEXT,
    "user_username" TEXT,
    "user_email" TEXT,
    "user_password_hash" TEXT,
    "user_first_name" TEXT NOT NULL,
    "user_last_name" TEXT NOT NULL,
    "user_image" TEXT,
    "user_language" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);
INSERT INTO "new_user" ("created_at", "deleted_at", "user_first_name", "user_id", "user_image", "user_language", "user_last_name", "user_phone") SELECT "created_at", "deleted_at", "user_first_name", "user_id", "user_image", "user_language", "user_last_name", "user_phone" FROM "user";
DROP TABLE "user";
ALTER TABLE "new_user" RENAME TO "user";
CREATE INDEX "user_first_name_idx" ON "user"("user_first_name");
CREATE INDEX "user_last_name_idx" ON "user"("user_last_name");
CREATE INDEX "user_deleted_at_idx" ON "user"("deleted_at");
CREATE UNIQUE INDEX "user_phone_idx" ON "user"("user_phone") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "user_username_idx" ON "user"("user_username") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "user_email_idx" ON "user"("user_email") WHERE "deleted_at" IS NULL;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

