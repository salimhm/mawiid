import { t } from 'elysia'

export const dto_event = {
  ticket: {
    response: t.Object({
      data: t.Object({
        ticket: t.String(),
        expires_in: t.Number(),
      }),
    }),
  },
  socket: {
    query: t.Object({
      ticket: t.String({ minLength: 1, maxLength: 64 }),
    }),
  },
}
