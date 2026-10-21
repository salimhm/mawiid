import '@lib/env.lib';
import { Elysia } from 'elysia';
import { lib_context, lib_database, lib_redis } from '@lib/context.lib';
import { lib_middleware_error } from '@lib/middleware.lib';
import { lib_openapi } from '@lib/openapi.lib';
import { controller_presence } from '@module/main/presence/presence.controller';
import { service_presence } from '@module/main/presence/presence.service';

if (import.meta.main) {
  try {
    const port = Number(process.env.BACKEND_PORT) || 3000;
    let stop_presence = () => {};
    const app = new Elysia()
      .use(lib_middleware_error)
      .use(lib_openapi)
      .use(lib_context)
      .get(
        '/health',
        () => {
          return { message: 'hello world' };
        },
        { detail: { tags: ['health'], summary: 'Check that the backend is running' } },
      )
      .use(controller_presence)
      .onStop(async () => {
        stop_presence();
        lib_redis.close();
        await lib_database.close();
      })
      .listen(port);

    stop_presence = await service_presence.start(app.server!, lib_database, lib_redis);

    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void app.stop().catch(() => {
        console.error('Backend shutdown failed');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(
      `${process.env.APP_NAME || 'mawiid'} listening on port ${port}`,
    );
  } catch {
    console.error('Backend startup failed');
    process.exitCode = 1;
  }
}
