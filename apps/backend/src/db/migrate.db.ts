import { apply_migration } from '@db/utils.db'

const applied = await apply_migration(process.env.TURSODB_URL!, 'prisma/main/migrations', process.env.TURSODB_TOKEN!)

console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Main database is already up to date.')
