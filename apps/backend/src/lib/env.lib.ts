const required = [
  // 'TURSODB_URL',
  'TURSODB_TOKEN',
  'TURSODB_DB',
  'TURSODB_ORG',
  'TURSODB_GROUP_NAME',
  'TURSODB_GROUP_TOKEN',
  'REDIS_URL',
] as const

const missing = required.filter((key) => !process.env[key])

if (missing.length > 0) {
  console.error(`[env] Missing required environment variables:\n${missing.map((key) => `  - ${key}`).join('\n')}`)
  process.exit(1)
}
