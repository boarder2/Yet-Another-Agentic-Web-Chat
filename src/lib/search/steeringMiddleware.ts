import type { EventEmitter } from 'events';
import { createMiddleware } from 'langchain';
import { HumanMessage } from '@langchain/core/messages';
import { drainSteers } from '@/lib/runs/steering';
import { emitStreamEvent } from '@/lib/streaming/events';

/**
 * Delivers queued steers before each model call — once every in-flight tool
 * call has finished — as plain user messages. Each delivery is announced so
 * the run host places its widget where the agent received it.
 */
export function steeringMiddleware(options: {
  messageId: string;
  emitter: EventEmitter;
  toContent: (text: string) => Promise<string>;
}) {
  return createMiddleware({
    name: 'SteeringMiddleware',
    beforeModel: async () => {
      const steers = drainSteers(options.messageId);
      if (steers.length === 0) return;
      const messages: HumanMessage[] = [];
      for (const steer of steers) {
        messages.push(new HumanMessage(await options.toContent(steer.content)));
        emitStreamEvent(options.emitter, {
          type: 'steer_applied',
          data: { steerId: steer.id, content: steer.content },
        });
      }
      return { messages };
    },
  });
}
