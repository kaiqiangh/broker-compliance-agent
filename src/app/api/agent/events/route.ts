import { withAuth } from '@/lib/auth';

interface StoredEvent {
  id: number;
  firmId: string;
  type: string;
  data: any;
  timestamp: string;
}

// In-memory subscribers and event store
const subscribers = new Map<string, Set<ReadableStreamDefaultController>>();
const eventStores = new Map<string, StoredEvent[]>();
let globalEventId = 0;

export function publishAgentEvent(firmId: string, event: { type: string; data: any }) {
  const stored: StoredEvent = {
    id: ++globalEventId,
    firmId,
    type: event.type,
    data: event.data,
    timestamp: new Date().toISOString(),
  };

  // Store for replay (last 100 per firm)
  if (!eventStores.has(firmId)) {
    eventStores.set(firmId, []);
  }
  const store = eventStores.get(firmId)!;
  store.push(stored);
  if (store.length > 100) store.shift();

  // Push to active subscribers
  const subs = subscribers.get(firmId);
  if (!subs || subs.size === 0) return;

  const encoder = new TextEncoder();
  const payload = `id: ${stored.id}\ndata: ${JSON.stringify(stored)}\n\n`;

  for (const controller of subs) {
    try {
      controller.enqueue(encoder.encode(payload));
    } catch {
      subs.delete(controller);
    }
  }
}

export const GET = withAuth(null, async (user, request) => {
  const encoder = new TextEncoder();
  const firmId = user.firmId;

  // Connection limit: max 2 per firm
  const existingSubs = subscribers.get(firmId);
  if (existingSubs && existingSubs.size >= 2) {
    return new Response(
      JSON.stringify({ error: { code: 'TOO_MANY_CONNECTIONS', message: 'Max 2 SSE connections' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      // Add subscriber
      if (!subscribers.has(firmId)) {
        subscribers.set(firmId, new Set());
      }
      subscribers.get(firmId)!.add(controller);

      // Send initial connection event
      controller.enqueue(encoder.encode(`id: 0\nevent: connected\ndata: {"status":"ok"}\n\n`));

      // Replay missed events (if client sent Last-Event-ID)
      const lastEventId = request.headers.get('last-event-id');
      if (lastEventId) {
        const lastId = parseInt(lastEventId, 10);
        const events = eventStores.get(firmId) || [];
        const missed = events.filter(e => e.id > lastId);
        for (const event of missed) {
          try {
            controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));
          } catch { break; }
        }
      }

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
