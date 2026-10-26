const required = [
  'ENV',
  'JWT_SECRET_KEY',
  // 'TURSODB_URL',
  'TURSODB_TOKEN',
  'TURSODB_DB',
  'TURSODB_ORG',
  'TURSODB_GROUP_NAME',
  'TURSODB_GROUP_TOKEN',
  'REDIS_URL',

  // 'LIVEKIT'
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
] as const;

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `[env] Missing required environment variables:\n${missing.map((key) => `  - ${key}`).join('\n')}`,
  );
  process.exit(1);
}

if (process.env.ENV !== 'dev' && process.env.JWT_SECRET_KEY!.length < 32) {
  console.error('[env] JWT_SECRET_KEY must be at least 32 characters outside dev.');
  process.exit(1);
}
