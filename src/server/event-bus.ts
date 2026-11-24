import { EventEmitter } from 'node:events';

export type BusEvent = 'message' | 'reply' | 'order' | 'status' | 'log';

class EventBus extends EventEmitter {
  emit(event: BusEvent, payload: unknown): boolean {
    return super.emit(event, payload);
  }

  on(event: BusEvent, listener: (payload: unknown) => void): this {
    return super.on(event, listener);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
