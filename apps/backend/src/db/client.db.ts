/** Main and department-vault connection routing. */

import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient as MainClient } from './generated/main/client.ts';
import { PrismaClient as TenantClient } from './generated/tenant/client.ts';

const authToken = process.env.TURSODB_TOKEN || undefined;

// Create Main Db
export const mainDb = new MainClient({
    adapter: new PrismaLibSql({ url: process.env.TURSODB_URL!, authToken }),
});

// Create Tenant Db
const maxVaults = Number(process.env.DB_MAX_CACHED_TENANTS ?? 100);
const vaults = new Map<string, TenantClient>();

export function vaultDb(url: string) {
    let db = vaults.get(url);
    if (db) {
        vaults.delete(url);
    } else {
        db = new TenantClient({
            adapter: new PrismaLibSql({ url, authToken }),
        });
    }
    vaults.set(url, db);
    if (vaults.size > maxVaults) {
        const [oldUrl, oldDb] = vaults.entries().next().value!;
        vaults.delete(oldUrl);
        void oldDb.$disconnect();
    }
    return db;
}
