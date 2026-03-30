import { describe, it, expect } from 'vitest';
import { getQueueStatus } from '@/lib/agent/queue';

describe('Job queue', () => {
  it('returns queue status without throwing', async () => {
    const status = await getQueueStatus();
    expect(status).toBeDefined();
    // Either BullMQ counts or memory fallback
    expect(
      'pending' in status || 'waiting' in status
    ).toBe(true);
  });
});
