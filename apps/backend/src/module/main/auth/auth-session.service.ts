import type { create_database_client } from '@db/client.db'
import type { lib_dto_payload } from '@lib/dto.lib'
import { lib_error } from '@lib/error.lib'

export const service_auth_session = {
  async find(payload: lib_dto_payload, session_version: number, database: ReturnType<typeof create_database_client>) {
    const user = await database.main_db.user.findFirst({
      where: { user_id: payload.user_id, deleted_at: null },
      select: { user_session_version: true },
    })
    if (!user || user.user_session_version !== session_version) throw lib_error.invalid_token
    return payload
  },
}
