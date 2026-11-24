import { WebSocketServer, type WebSocket } from 'ws';
import pino from 'pino';
import type { Server } from 'node:http';
import { eventBus, type BusEvent } from './event-bus.js';

export interface WebSocketOptions {
  /** Attach to an existing HTTP server (same port as the dashboard). */
  httpServer?: Server;
  /** Or listen on a dedicated port. */
  port?: number;
  path?: string;
  token?: string;
  /** Called when the dashboard asks the bot to send a WhatsApp message. */
  sendMessage?: (jid: string, text: string) => Promise<void>;
}

const allowed = (token: string | undefined, supplied: string | undefined): boolean => {
  if (!token) return true;
  return supplied === token;
};

export const startWebSocketGateway = (options: WebSocketOptions): WebSocketServer => {
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  const path = options.path ?? '/ws';
  const server = options.httpServer
    ? new WebSocketServer({ noServer: true })
    : new WebSocketServer({ port: options.port ?? 8080, path });

  if (options.httpServer) {
    options.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== path) {
        socket.destroy();
        return;
      }
      server.handleUpgrade(request, socket, head, (client) => {
        server.emit('connection', client, request);
      });
    });
  }

  const clients = new Set<WebSocket>();
  const broadcast = (type: BusEvent, payload: unknown): void => {
    const frame = JSON.stringify({ type, payload, at: Date.now() });
    for (const client of clients) {
      if (client.readyState === 1) client.send(frame);
    }
  };

  const events: BusEvent[] = ['message', 'reply', 'order', 'status', 'log'];
  for (const event of events) {
    eventBus.on(event, (payload) => broadcast(event, payload));
  }

  server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? undefined;
    if (!allowed(options.token, token)) {
      socket.send(JSON.stringify({ type: 'log', payload: { level: 'error', message: 'unauthorized' } }));
      socket.close();
      return;
    }

    clients.add(socket);
    socket.send(JSON.stringify({ type: 'status', payload: { connected: true, clients: clients.size } }));

    socket.on('message', async (raw) => {
      let frame: { type?: string; jid?: string; text?: string };
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'log', payload: { level: 'error', message: 'invalid json' } }));
        return;
      }

      if (frame.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
        return;
      }

      if (frame.type === 'broadcast' && frame.jid && frame.text) {
        const jid = frame.jid.trim();
        const text = frame.text.trim();
        if (!/^[\w.@-]+@(g\.us|s\.whatsapp\.net)$/.test(jid) || !text) {
          socket.send(JSON.stringify({ type: 'log', payload: { level: 'error', message: 'invalid jid or text' } }));
          return;
        }
        try {
          await options.sendMessage?.(jid, text);
          socket.send(JSON.stringify({ type: 'log', payload: { level: 'info', message: `sent to ${jid}` } }));
        } catch (error) {
          socket.send(JSON.stringify({
            type: 'log',
            payload: { level: 'error', message: error instanceof Error ? error.message : 'send failed' }
          }));
        }
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
    });
  });

  server.on('listening', () => logger.info({ path, port: options.port }, 'websocket gateway listening'));
  server.on('error', (error) => logger.error({ error }, 'websocket gateway error'));

  return server;
};
