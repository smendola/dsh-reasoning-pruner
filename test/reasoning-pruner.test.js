import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, pruneHistoricalReasoning } from '../index.js';

const messages = [
  { role: 'system', content: [{ type: 'text', text: 'system' }] },
  { role: 'user', content: [{ type: 'text', text: 'question 1' }, { type: 'image', attachment: { id: 'image-1' } }] },
  { role: 'assistant', content: [{ type: 'reasoning', text: 'reasoning 1' }, { type: 'text', text: 'answer 1' }, { type: 'tool-call', id: 'call-1', name: 'tool', arguments: '{}' }] },
  { role: 'tool', content: [{ type: 'text', text: 'tool result 1' }], toolCallId: 'call-1' },
  { role: 'user', content: [{ type: 'text', text: 'question 2' }] },
  { role: 'assistant', content: [{ type: 'reasoning', text: 'reasoning 2' }, { type: 'text', text: 'answer 2' }] },
  { role: 'user', content: [{ type: 'text', text: 'question 3' }] },
  { role: 'assistant', content: [{ type: 'reasoning', text: 'current reasoning' }, { type: 'tool-call', id: 'call-2', name: 'tool', arguments: '{}' }] }
];

test('prunes only completed assistant reasoning without mutating history', () => {
  const pruned = pruneHistoricalReasoning(messages);

  assert.equal(messages[2].content[0].text, 'reasoning 1');
  assert.deepEqual(pruned.map((message) => message.content.map((block) => block.type)), [
    ['text'], ['text', 'image'], ['text', 'tool-call'], ['text'], ['text'], ['text'], ['text'], ['reasoning', 'tool-call']
  ]);
});

test('forwards a pruned clone and bypasses auxiliary requests', () => {
  let listener;
  let forwarded;
  const events = [];
  const ctx = {
    llm: {
      stream(request) {
        forwarded = request;
        return 'adapter-stream';
      }
    },
    on(_event, handler) {
      listener = handler;
    },
    sessions: {
      get() {
        return {
          append(type, data) {
            events.push({ type, data });
          }
        };
      }
    },
    tokenMeter: {
      estimateMessage(message) {
        return message.content.reduce((total, block) => total + (block.text?.length ?? 0), 0);
      }
    }
  };
  apply(ctx);

  const request = Object.freeze({ sessionId: 'session-1', messages: Object.freeze(messages) });
  assert.equal(listener(request, () => 'original-stream'), 'adapter-stream');
  assert.notEqual(forwarded, request);
  assert.equal(forwarded.messages[2].content.some((block) => block.type === 'reasoning'), false);
  assert.equal(forwarded.messages[5].content.some((block) => block.type === 'reasoning'), false);
  assert.equal(forwarded.messages[7].content.some((block) => block.type === 'reasoning'), true);
  assert.equal(request.messages[2].content[0].text, 'reasoning 1');
  assert.deepEqual(events.map((event) => event.type), ['command/run', 'command/done']);
  assert.equal(events[0].data.name, 'reasoning-pruner');
  assert.equal(events[1].data.text, 'Pruned 2 historical reasoning blocks (~22 tokens) from the model request.');

  const compaction = Object.freeze({ sessionId: 'session-1', purpose: 'compaction', messages: Object.freeze(messages) });
  assert.equal(listener(compaction, () => 'unchanged'), 'unchanged');
});
