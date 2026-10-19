/** Applies pending main-database migrations to Turso. Run with `bun run db:deploy:main`. */

import { applyMigration } from './utils.db.ts';

const applied = await applyMigration(
    process.env.TURSODB_URL!,
    'prisma/main/migrations',
    process.env.TURSODB_TOKEN!,
);

console.log(
    applied.length
        ? `Applied: ${applied.join(', ')}`
        : 'Main database is already up to date.',
);
