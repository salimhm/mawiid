import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@libsql/client'

export async function apply_migration(url: string, directory: string, auth_token: string) {
  const db = createClient({ url, authToken: auth_token })
  await db.execute(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  )
  const applied = new Set((await db.execute('SELECT name FROM _migrations')).rows.map((row) => String(row.name)))
  const pending = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort()

  for (const name of pending) {
    const sql = await readFile(join(directory, name, 'migration.sql'), 'utf8')
    const transaction = await db.transaction('write')
    try {
      await transaction.executeMultiple(sql)
      await transaction.execute({ sql: 'INSERT INTO _migrations (name) VALUES (?)', args: [name] })
      await transaction.commit()
    } finally {
      transaction.close()
    }
  }
  db.close()
  return pending
}
