import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@domdelo/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { storedObjects } from '../db/schema.js';

export type StoredObject = {
  key: string;
  url: string;
};

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  url(key: string): Promise<string>;
  get?(key: string, access?: { expires?: string; signature?: string }): Promise<{ body: Buffer; contentType: string } | undefined>;
}

export class PostgresObjectStorage implements ObjectStorage {
  constructor(private readonly db: Database, private readonly secret: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.db.insert(storedObjects).values({
      key,
      contentType,
      bodyBase64: body.toString('base64'),
    });
    return { key, url: await this.url(key) };
  }

  async url(key: string): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + 900;
    const signature = this.sign(key, expires);
    return `/api/files/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`;
  }

  async get(key: string, access?: { expires?: string; signature?: string }): Promise<{ body: Buffer; contentType: string } | undefined> {
    const expires = Number(access?.expires);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expires) || expires < now || expires > now + 900) return undefined;
    if (!access?.signature || !/^[a-f0-9]{64}$/iu.test(access.signature)) return undefined;
    const expected = Buffer.from(this.sign(key, expires), 'hex');
    const actual = Buffer.from(access.signature, 'hex');
    if (!timingSafeEqual(expected, actual)) return undefined;

    const [item] = await this.db.select().from(storedObjects).where(eq(storedObjects.key, key)).limit(1);
    if (!item) return undefined;
    return { body: Buffer.from(item.bodyBase64, 'base64'), contentType: item.contentType };
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${key}\n${expires}`).digest('hex');
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, url: await this.url(key) };
  }

  async url(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key }),
      { expiresIn: 900 },
    );
  }

}

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    this.objects.set(key, { body, contentType });
    return { key, url: await this.url(key) };
  }

  async url(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | undefined> {
    return this.objects.get(key);
  }
}
