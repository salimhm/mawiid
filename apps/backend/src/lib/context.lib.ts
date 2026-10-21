import '@lib/env.lib';
import { Elysia } from 'elysia';
import { create_database_client } from '@db/client.db';
import { create_redis_client } from '@storage/redis.storage';

export const lib_database = create_database_client();
export const lib_redis = create_redis_client();

export const lib_context = new Elysia({ name: 'lib_context' })
  .decorate('database', lib_database)
  .decorate('redis', lib_redis);
