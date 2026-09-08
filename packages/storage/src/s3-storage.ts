import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./types.js";

export interface S3StorageConfig {
  /** Omit for real AWS S3; set for R2/MinIO/any other S3-compatible endpoint. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO needs this; real AWS S3 does not. */
  forcePathStyle?: boolean;
}

/**
 * Real S3-compatible storage (spec §18/§45 — AWS S3, Cloudflare R2, or a real MinIO once Docker/ADR-007
 * is no longer needed). Not exercised against a live endpoint in this project's own sessions so far — see
 * ADR-007; only the ADR-007 `LocalFsStorage` fallback has actually been run and verified here.
 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType })
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    const body = response.Body;
    if (!body) throw new Error(`S3 object ${key} has no body`);
    const chunks: Uint8Array[] = [];
    // @ts-expect-error -- Body's runtime type (a Node Readable in the Node SDK build) supports
    // async-iteration even though the SDK's cross-platform type doesn't declare it generically.
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getSignedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
