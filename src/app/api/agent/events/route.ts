import { withAuth } from '@/lib/auth';

// Simple in-memory pub/sub for SSE (replace with Redis in production)
const subscribers = new Map<string, Set<ReadableStreamDefaultController>>();

export function publishAgentEvent(firmId: string, event: { type: string; data: any }) {
  const subs = subscribers.get(firmId);
  if (!subs) return;

  const payload = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
  const encoder = new TextEncoder();

  for (const controller of subs) {
    try {
      controller.enqueue(encoder.encode(payload));
    } catch {
      subs.delete(controller);
    }
  }

  if (subs.size === 0) {
    subscribers.delete(firmId);
  }
}

export const GET = withAuth(null, async (user, request) => {
  const encoder = new TextEncoder();
  const firmId = user.firmId;

  // Connection limit: max 2 per user
  const existingSubs = subscribers.get(firmId);
  if (existingSubs && existingSubs.size >= 2) {
    return new Response(JSON.stringify({ error: { code: 'TOO_MANY_CONNECTIONS', message: 'Max 2 SSE connections per firm' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Add to subscribers
      if (!subscribers.has(firmId)) {
        subscribers.set(firmId, new Set());
      }
      subscribers.get(firmId)!.add(controller);

      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"ok"}\n\n`));

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        subscribers.get(firmId)?.delete(controller);
        if (subscribers.get(firmId)?.size === 0) {
          subscribers.delete(firmId);
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
