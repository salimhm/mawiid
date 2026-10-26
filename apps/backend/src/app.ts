import '@lib/env.lib';
import { Elysia } from 'elysia';
import { create_database_client } from '@db/client.db';
import { create_redis_client } from '@storage/redis.storage';
import { lib_middleware_error } from '@lib/middleware.lib';
import { controller_audit } from '@module/main/participants/audit.controller';
import { controller_event } from '@module/main/participants/event.controller';
import { service_event } from '@module/main/participants/event.service';
import { controller_participant } from '@module/main/participants/participant.controller';
import { controller_room_member } from '@module/main/participants/room-member.controller';
import { controller_webhook } from '@module/main/participants/webhook.controller';
import { controller_room } from '@module/tenant/room/room.controller';
import { controller_message } from '@module/main/message/message.controller';

if (import.meta.main) {
  try {
    const database = create_database_client();
    const redis = create_redis_client();
    const port = Number(process.env.BACKEND_PORT) || 3000;
    const app = new Elysia()
      .decorate('database', database)
      .decorate('redis', redis)
      .use(lib_middleware_error)
      .use(controller_participant)
      .use(controller_room)
      .use(controller_room_member)
      .use(controller_audit)
      .use(controller_event)
      .use(controller_webhook)
      .use(controller_message)
      .onStop(async () => {
        subscriber.close();
        redis.close();
        await database.close();
      })
      .listen(port)
      .get('/health', () => {
        return { message: 'hello world' };
      });
    const subscriber = await service_event.relay(app.server!, redis);

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
