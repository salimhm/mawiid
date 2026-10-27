import { t } from 'elysia';
import { lib_dto_find_response, lib_dto_room_body } from '@lib/dto.lib';

export const dto_schema_message = t.Object({
  message_id: t.Integer(),
  room_uid: t.String({ format: 'uuid' }),
  user_id: t.Integer(),
  message_client_id: t.String({ format: 'uuid' }),
  message_text: t.String(),
  created_at: t.Date(),
});

export const dto_schema_message_delivery = t.Object({
  ...dto_schema_message.properties,
  recipient_user_id: t.Nullable(t.Integer()),
});

export const dto_message = {
  find: {
    query: t.Object({
      room_uid: t.String({
        format: 'uuid',
        description: 'Room whose message history to load.',
      }),
      take: t.Optional(
        t.Numeric({
          minimum: 1,
          maximum: 100,
          multipleOf: 1,
          default: 50,
          description: 'Maximum messages to return.',
        }),
      ),
      before_message_id: t.Optional(
        t.Numeric({
          minimum: 1,
          multipleOf: 1,
          description: 'Return messages older than this id.',
        }),
      ),
      after_message_id: t.Optional(
        t.Numeric({
          minimum: 1,
          multipleOf: 1,
          description: 'Return messages newer than this id.',
        }),
      ),
    }),
    response: t.Object({
      ...lib_dto_find_response,
      data: t.Array(dto_schema_message),
    }),
  },
  create: {
    body: t.Object({
      ...lib_dto_room_body,
      recipient_user_id: t.Optional(
        t.Integer({
          minimum: 1,
          description:
            'The one active room member who receives this message. Omit to send it to the whole room.',
        }),
      ),
      message_client_id: t.String({
        format: 'uuid',
        description: 'Client-generated id used to retry safely.',
      }),
      message_text: t.String({
        minLength: 1,
        maxLength: 3000,
        pattern: '\\S',
        description: 'Plain-text message content.',
      }),
    }),
    response: t.Object({
      data: dto_schema_message_delivery,
    }),
  },
};
