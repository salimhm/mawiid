/** Reusable database helpers and migration utilities. */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

export async function applyMigration(
    url: string,
    dir: string,
    authToken: string,
) {
    const db = createClient({ url, authToken });
    await db.execute(
        'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    const applied = new Set(
        (await db.execute('SELECT name FROM _migrations')).rows.map((r) =>
            String(r.name),
        ),
    );
    const pending = (await readdir(dir, { withFileTypes: true }))
        .filter(
            (e: { isDirectory: any; name: string }) =>
                e.isDirectory() && !applied.has(e.name),
        )
        .map((e: { name: string }) => e.name)
        .sort();

    for (const name of pending) {
        const sql = await readFile(join(dir, name, 'migration.sql'), 'utf8');
        const tx = await db.transaction('write');
        try {
            await tx.executeMultiple(sql);
            await tx.execute({
                sql: 'INSERT INTO _migrations (name) VALUES (?)',
                args: [name],
            });
            await tx.commit();
        } finally {
            tx.close();
        }
    }
    db.close();
    return pending;
}
