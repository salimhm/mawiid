import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { RedisClient } from 'bun';
import type { Static } from 'elysia';
import type { create_database_client } from '@db/client.db';
import { lib_error } from '@lib/error.lib';
import { service_room_route } from '@module/main/participants/room-route.service';
import type { dto_transcript } from '@module/main/transcript/transcript.dto';
import { service_transcript } from '@module/main/transcript/transcript.service';

const find_route = spyOn(service_room_route, 'find');
const migrate = spyOn(service_transcript, 'migrate').mockResolvedValue(undefined);

const room_uid = '00000000-0000-4000-8000-000000000001';
const token = 'internal-test-token-at-least-32-characters';

const body: Static<typeof dto_transcript.internal.body> = {
  room_uid,
  segments: [
    {
      transcript_segment_id: 'SG_1',
      user_id: 7,
      transcript_language: 'fr-FR',
      transcript_text: ' Bonjour à tous. ',
      transcript_started_ms: 1200,
      transcript_ended_ms: 2400,
      translations: [
        { translation_language: 'en-US', translation_text: 'Hello everyone.' },
        { translation_language: 'ar-SA', translation_text: 'مرحبا بالجميع.' },
      ],
    },
  ],
};

function create_fixture() {
  const transcript = { upsert: mock(async () => ({ transcript_id: 11 })) };
  const translation = { upsert: mock(async () => ({ translation_id: 1 })) };
  const vault = {
    room: { findFirst: mock(async (): Promise<{ room_id: number } | null> => ({ room_id: 4 })) },
    $transaction: mock(async (run: (transaction: unknown) => Promise<void>) => await run({ transcript, translation })),
  };
  const database = {} as ReturnType<typeof create_database_client>;
  find_route.mockResolvedValue(vault as unknown as Awaited<ReturnType<typeof service_room_route.find>>);
  return { database, redis: {} as RedisClient, transcript, translation, vault };
}

describe('service_transcript.internal', () => {
  beforeEach(() => {
    find_route.mockClear();
    migrate.mockClear();
    process.env.INTERNAL_SERVICE_TOKEN = token;
  });

  afterAll(() => {
    find_route.mockRestore();
    migrate.mockRestore();
  });

  test('saves each segment once with its translations', async () => {
    const fixture = create_fixture();

    const result = await service_transcript.internal(body, `Bearer ${token}`, fixture.database, fixture.redis);

    expect(result).toEqual({ data: { saved: 1 } });
    expect(fixture.transcript.upsert).toHaveBeenCalledWith({
      where: { room_id_transcript_segment_id: { room_id: 4, transcript_segment_id: 'SG_1' } },
      create: {
        room_id: 4,
        user_id: 7,
        transcript_segment_id: 'SG_1',
        transcript_language: 'fr-FR',
        transcript_text: 'Bonjour à tous.',
        transcript_started_ms: 1200,
        transcript_ended_ms: 2400,
      },
      update: {},
    });
    expect(fixture.translation.upsert).toHaveBeenCalledTimes(2);
    expect(fixture.translation.upsert).toHaveBeenCalledWith({
      where: { transcript_id_translation_language: { transcript_id: 11, translation_language: 'en-US' } },
      create: { transcript_id: 11, translation_language: 'en-US', translation_text: 'Hello everyone.' },
      update: {},
    });
  });

  test('refuses callers without the internal token', async () => {
    const fixture = create_fixture();

    for (const authorization of [undefined, 'Bearer wrong', `Basic ${token}`, token]) {
      await expect(
        service_transcript.internal(body, authorization, fixture.database, fixture.redis),
      ).rejects.toBe(lib_error.unauthorized);
    }
    delete process.env.INTERNAL_SERVICE_TOKEN;
    await expect(
      service_transcript.internal(body, `Bearer ${token}`, fixture.database, fixture.redis),
    ).rejects.toBe(lib_error.unauthorized);
    expect(fixture.vault.$transaction).not.toHaveBeenCalled();
  });

  test('refuses deleted rooms', async () => {
    const fixture = create_fixture();
    fixture.vault.room.findFirst.mockResolvedValue(null);

    await expect(
      service_transcript.internal(body, `Bearer ${token}`, fixture.database, fixture.redis),
    ).rejects.toBe(lib_error.room_not_found);
  });

  test('migrates vaults created before the transcript table, then saves', async () => {
    const missing = [
      Object.assign(new Error('The table `main.transcript` does not exist'), { code: 'P2021' }),
      Object.assign(new Error('SQLITE_ERROR: no such table: main.transcript'), { code: 'P2039' }),
    ];
    for (const error of missing) {
      const fixture = create_fixture();
      migrate.mockClear();
      fixture.transcript.upsert.mockRejectedValueOnce(error);

      const result = await service_transcript.internal(body, `Bearer ${token}`, fixture.database, fixture.redis);

      expect(result).toEqual({ data: { saved: 1 } });
      expect(migrate).toHaveBeenCalledWith(room_uid, fixture.database);
      expect(fixture.vault.$transaction).toHaveBeenCalledTimes(2);
    }
  });

  test('does not migrate on other database errors', async () => {
    const fixture = create_fixture();
    const error = Object.assign(new Error('SQLITE_BUSY'), { code: 'P1008' });
    fixture.transcript.upsert.mockRejectedValueOnce(error);

    await expect(
      service_transcript.internal(body, `Bearer ${token}`, fixture.database, fixture.redis),
    ).rejects.toBe(error);
    expect(migrate).not.toHaveBeenCalled();
  });
});
