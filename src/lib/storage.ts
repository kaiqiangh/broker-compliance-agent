import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageProvider {
  /** Upload a file and return its public/access URL */
  upload(storagePath: string, buffer: Buffer, contentType?: string): Promise<string>;
  /** Download a file, returns buffer or null if not found */
  download(storagePath: string): Promise<Buffer | null>;
  /** Get the public URL for a stored file */
  getUrl(storagePath: string): string;
  /** Whether this provider is cloud-based (for redirect logic) */
  isCloud(): boolean;
}

// ─── Local Filesystem ────────────────────────────────────────────────────────

class LocalStorage implements StorageProvider {
  private root: string;

  constructor() {
    this.root = path.join(process.cwd(), 'uploads');
  }

  async upload(storagePath: string, buffer: Buffer): Promise<string> {
    const fs = await import('fs/promises');
    const fullPath = path.join(this.root, storagePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return this.getUrl(storagePath);
  }

  async download(storagePath: string): Promise<Buffer | null> {
    const fs = await import('fs/promises');
    const fullPath = path.join(this.root, storagePath);
    try {
      return await fs.readFile(fullPath);
    } catch {
      return null;
    }
  }

  getUrl(storagePath: string): string {
    return `/api/files/${storagePath}`;
  }

  isCloud(): boolean {
    return false;
  }
}

// ─── S3 / R2 ─────────────────────────────────────────────────────────────────

class S3Storage implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string | undefined;

  constructor() {
    const endpoint = process.env.R2_ENDPOINT!;
    this.bucket = process.env.R2_BUCKET!;
    this.publicUrl = process.env.R2_PUBLIC_URL;

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  async upload(storagePath: string, buffer: Buffer, contentType?: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return this.getUrl(storagePath);
  }

  async download(storagePath: string): Promise<Buffer | null> {
    try {
      const resp = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
        })
      );
      const stream = resp.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  getUrl(storagePath: string): string {
    if (this.publicUrl) {
      // Public bucket: return direct URL
      return `${this.publicUrl}/${storagePath}`;
    }
    // Fall back to local API route which will presign on access
    return `/api/files/${storagePath}`;
  }

  isCloud(): boolean {
    return true;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _storage: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (_storage) return _storage;

  const hasS3 =
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_ENDPOINT;

  _storage = hasS3 ? new S3Storage() : new LocalStorage();
  return _storage;
}

/** Generate a storage path from firm, context, and filename */
export function buildStoragePath(
  firmId: string,
  contextId: string,
  fileName: string
): string {
  return `${firmId}/${contextId}/${fileName}`;
}
