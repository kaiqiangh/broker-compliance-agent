import { getStorage, buildStoragePath } from '@/lib/storage';

/**
 * Store raw email in R2/S3.
 * Non-blocking: returns URL on success, null on failure.
 */
export async function storeRawEmail(
  firmId: string,
  messageId: string,
  raw: Buffer
): Promise<string | null> {
  try {
    const storage = getStorage();
    const safeId = messageId.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 100);
    const key = buildStoragePath(firmId, 'emails', `${safeId}.eml`);

    const url = await storage.upload(key, raw, 'message/rfc822');
    return url;
  } catch (err) {
    console.error(`[storeRawEmail] Failed for firm ${firmId}:`, err);
    return null;
  }
}
