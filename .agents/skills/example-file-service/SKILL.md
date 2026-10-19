---
name: example-file-service
description: Required code pattern for client storage & file service generated outputs.
---

1. **Storage Client (storage/client.storage.ts)**: Strictly follow this pattern!

```typescript
import { S3Client } from '@aws-sdk/client-s3'

export const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})
```

2. **Upload Files (file/file.service.ts)**: Strictly follow this pattern!

```typescript
import { R2 } from '@storage/client.storage.ts'

// other functions...

async create(
  body: Static<typeof dto_file.create.body>,
  payload: lib_dto_payload
): Promise<Static<typeof dto_file.create.response>> {
  const { file } = body
  const { user_id } = payload

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) throw require(`@lib/error.lib.ts`).bad_request;

  const current_time = Date.now().toString();
  const random = Math.floor(Math.random() * (2_000_000 - 1_000_000 + 1)) + 1_000_000;

  const file_extension = file.name ? `.${file.name.split('.').pop()}` : ''
  const folder_name = `user-${user_id}`
  const file_id = `${folder_name}/${current_time}${random}${file_extension}`

  const file_name = (body.file_name ? body.file_name : file.name).slice(0, 127)

  try {
    const file_buffer = await file.arrayBuffer();

    const command = new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
      Key: file_id,
      Body: Buffer.from(file_buffer),
      ContentType: file.type,
    })

    await R2.send(command)

    const db = await db_client()
    const [data] = await db
    .insert(table_file)
    .values({
      file_id,
      file_name,
      user_id,
    })
    .returning()

    return { data }
  } catch (error) {
    throw require(`@lib/error.lib.ts`).internal_server_error
  }
}

// other functions...
```
