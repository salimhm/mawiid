import { t } from 'elysia';

const transcript_language = t.String({
  pattern: '^[a-z]{2,3}(-[A-Z]{2})?$',
  description: 'Language code, for example `fr-FR`.',
});

export const dto_schema_transcript_segment = t.Object({
  transcript_segment_id: t.String({
    minLength: 1,
    maxLength: 64,
    description: 'Caption segment id (`lk.segment_id`). Saving the same segment again changes nothing.',
  }),
  user_id: t.Integer({ minimum: 1, description: 'The speaker.' }),
  transcript_language,
  transcript_text: t.String({ minLength: 1, maxLength: 10000 }),
  transcript_started_ms: t.Integer({
    minimum: 0,
    maximum: 2147483647,
    description: 'Milliseconds since the translator joined the live.',
  }),
  transcript_ended_ms: t.Integer({ minimum: 0, maximum: 2147483647 }),
  translations: t.Array(
    t.Object({
      translation_language: transcript_language,
      translation_text: t.String({ minLength: 1, maxLength: 10000 }),
    }),
    { maxItems: 10 },
  ),
});

export const dto_transcript = {
  internal: {
    detail: {
      tags: ['Transcript'],
      summary: 'Save transcript segments (AI worker only)',
      description:
        'Called by the AI translation worker with `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. Saves final caption segments and their translations in the vault of the room. Segments already saved are left unchanged, so the worker can retry a batch safely.',
    },
    body: t.Object(
      {
        room_uid: t.String({ format: 'uuid' }),
        segments: t.Array(dto_schema_transcript_segment, { minItems: 1, maxItems: 100 }),
      },
      {
        examples: [
          {
            room_uid: '00000000-0000-4000-8000-000000000001',
            segments: [
              {
                transcript_segment_id: 'SG_3f2a9c1d7b4e',
                user_id: 1,
                transcript_language: 'fr-FR',
                transcript_text: 'Bonjour à tous.',
                transcript_started_ms: 1200,
                transcript_ended_ms: 2400,
                translations: [{ translation_language: 'en-US', translation_text: 'Hello everyone.' }],
              },
            ],
          },
        ],
      },
    ),
    response: t.Object({
      data: t.Object({ saved: t.Integer() }),
    }),
  },
};
