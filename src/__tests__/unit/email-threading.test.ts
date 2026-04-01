import { describe, expect, it } from 'vitest';
import { resolveThreadId } from '@/lib/email/threading';

describe('resolveThreadId', () => {
  it('uses the root reference when References are present', () => {
    expect(
      resolveThreadId({
        messageId: 'msg-c',
        inReplyTo: 'msg-b',
        references: ['msg-a', 'msg-b'],
      })
    ).toBe('msg-a');
  });

  it('falls back to In-Reply-To when References are absent', () => {
    expect(
      resolveThreadId({
        messageId: 'msg-b',
        inReplyTo: 'msg-a',
        references: [],
      })
    ).toBe('msg-a');
  });

  it('falls back to the current message id for new threads', () => {
    expect(
      resolveThreadId({
        messageId: 'msg-a',
        inReplyTo: null,
        references: [],
      })
    ).toBe('msg-a');
  });
});
