import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@domdelo/config';

export type StoredObject = {
  key: string;
  url: string;
};

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  url(key: string): Promise<string>;
  get?(key: string): Promise<{ body: Buffer; contentType: string } | undefined>;
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

  async get(key: string): Promise<{ body: Buffer; contentType: string } | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key }),
      );
      if (!response.Body) return undefined;
      const bytes = await response.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: response.ContentType || 'application/octet-stream',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') return undefined;
      throw error;
    }
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
