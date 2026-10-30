import { createHash, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { RedisClient } from 'bun';
import type { Static } from 'elysia';
import type { create_database_client } from '@db/client.db';
import { apply_migration } from '@db/utils.db';
import { lib_error } from '@lib/error.lib';
import { dto_transcript } from '@module/main/transcript/transcript.dto';
import { service_room_route } from '@module/main/participants/room-route.service';

const transcript_migration_directory = join(import.meta.dir, '../../../../prisma/tenant/migrations');
const transcript_missing_table_code = 'P2021';
const transcript_missing_table_message = 'no such table';

function transcript_digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function transcript_authorized(authorization: string | undefined) {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const [scheme, value] = authorization?.split(' ') ?? [];
  if (!token || scheme !== 'Bearer' || !value) return false;
  return timingSafeEqual(transcript_digest(value), transcript_digest(token));
}

function transcript_table_missing(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === transcript_missing_table_code) return true;
  return 'message' in error && String(error.message).includes(transcript_missing_table_message);
}

export const service_transcript = {
  async internal(
    body: Static<typeof dto_transcript.internal.body>,
    authorization: string | undefined,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_transcript.internal.response>> {
    if (!transcript_authorized(authorization)) throw lib_error.unauthorized;

    const vault = await service_room_route.find(body.room_uid, database, redis);
    const room = await vault.room.findFirst({
      where: { room_uid: body.room_uid, deleted_at: null },
      select: { room_id: true },
    });
    if (!room) throw lib_error.room_not_found;

    const save = () =>
      vault.$transaction(async (transaction) => {
        for (const segment of body.segments) {
          const transcript = await transaction.transcript.upsert({
            where: {
              room_id_transcript_segment_id: {
                room_id: room.room_id,
                transcript_segment_id: segment.transcript_segment_id,
              },
            },
            create: {
              room_id: room.room_id,
              user_id: segment.user_id,
              transcript_segment_id: segment.transcript_segment_id,
              transcript_language: segment.transcript_language,
              transcript_text: segment.transcript_text.trim(),
              transcript_started_ms: segment.transcript_started_ms,
              transcript_ended_ms: Math.max(segment.transcript_ended_ms, segment.transcript_started_ms),
            },
            update: {},
          });
          for (const translation of segment.translations) {
            await transaction.translation.upsert({
              where: {
                transcript_id_translation_language: {
                  transcript_id: transcript.transcript_id,
                  translation_language: translation.translation_language,
                },
              },
              create: {
                transcript_id: transcript.transcript_id,
                translation_language: translation.translation_language,
                translation_text: translation.translation_text.trim(),
              },
              update: {},
            });
          }
        }
      });

    try {
      await save();
    } catch (error) {
      if (!transcript_table_missing(error)) throw error;
      await service_transcript.migrate(body.room_uid, database);
      await save();
    }

    return { data: { saved: body.segments.length } };
  },

  async migrate(room_uid: string, database: ReturnType<typeof create_database_client>) {
    const route = await database.main_db.roomRoute.findFirst({
      where: { room_uid, deleted_at: null },
      select: { vault: { select: { vault_database_url: true } } },
    });
    if (!route) throw lib_error.room_not_found;
    await apply_migration(
      route.vault.vault_database_url,
      transcript_migration_directory,
      process.env.TURSODB_GROUP_TOKEN!,
    );
  },
};
