import '@lib/env.lib'
import { Elysia } from 'elysia'
import { create_database_client } from '@db/client.db'
import { create_redis_client } from '@storage/redis.storage'

if (import.meta.main) {
  try {
    const database = create_database_client()
    const redis = create_redis_client()
    const port = Number(process.env.BACKEND_PORT) || 3000
    const app = new Elysia()
      .decorate('database', database)
      .decorate('redis', redis)
      .onStop(async () => {
        redis.close()
        await database.close()
      })
      .listen(port)

    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void app.stop().catch(() => {
        console.error('Backend shutdown failed')
        process.exitCode = 1
      })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    console.log(`${process.env.APP_NAME || 'mawiid'} listening on port ${port}`)
  } catch {
    console.error('Backend startup failed')
    process.exitCode = 1
  }
}
