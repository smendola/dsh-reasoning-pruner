import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const name = 'reasoning-pruner';
export const inject = ['llm', 'sessions', 'tokenMeter'];

function isConversationRequest(options) {
  // dsh-agent-loop requests are frozen, session-backed, and have no auxiliary purpose.
  return options.sessionId !== undefined
    && options.system === undefined
    && options.purpose === undefined
    && Object.isFrozen(options)
    && Object.isFrozen(options.messages);
}

function requestClassification(options) {
  return {
    hasSessionId: options.sessionId !== undefined,
    hasSystem: options.system !== undefined,
    purpose: options.purpose ?? 'none',
    optionsFrozen: Object.isFrozen(options),
    messagesFrozen: Object.isFrozen(options.messages)
  };
}

function requestSummary(options) {
  return options.messages.map((message) => `${message.role}:${message.content.map((block) => block.type).join(',')}`).join(' | ');
}

function reasoningBlockCount(messages) {
  return messages.reduce((count, message) => count + message.content.filter((block) => block.type === 'reasoning').length, 0);
}

function estimatedTokensRemoved(tokenMeter, before, after) {
  const estimate = (messages) => messages.reduce((total, message) => total + tokenMeter.estimateMessage(message), 0);
  return Math.max(0, estimate(before) - estimate(after));
}

/** Remove reasoning only from assistant messages completed before this turn. */
export function pruneHistoricalReasoning(messages) {
  let currentTurnStart = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      currentTurnStart = index;
      break;
    }
  }

  if (currentTurnStart <= 0) return messages;

  let changed = false;
  const pruned = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (index >= currentTurnStart || message.role !== 'assistant') {
      pruned.push(message);
      continue;
    }

    const content = message.content.filter((block) => block.type !== 'reasoning');
    if (content.length === message.content.length) {
      pruned.push(message);
      continue;
    }

    changed = true;
    if (content.length > 0) pruned.push({ ...message, content });
  }

  return changed ? pruned : messages;
}

export function apply(ctx, config = {}) {
  const forwarded = new WeakSet();
  const debugLog = config.debugLogPath ?? join(process.env.DSH_HOME ?? homedir(), '.dsh', 'logs', 'reasoning-pruner.log');
  const debug = (message) => {
    if (config.debug !== true) return;
    const line = `${new Date().toISOString()} [${name}] ${message}`;
    ctx.logger?.info?.(line);
    try {
      mkdirSync(dirname(debugLog), { recursive: true, mode: 0o700 });
      appendFileSync(debugLog, `${line}\n`, { mode: 0o600 });
    } catch {
      // Debug tracing must never affect a model request.
    }
  };

  debug(`loaded enabled=${config.enabled !== false}`);

  ctx.on('llm/stream', (options, next) => {
    const forwardedRequest = forwarded.has(options);
    debug(`llm/stream entered forwarded=${forwardedRequest} messages=${requestSummary(options)}`);
    if (config.enabled === false) {
      debug('bypassed: disabled by configuration');
      return next();
    }
    if (forwardedRequest) {
      debug('forwarded clone reached interceptor; passing it to the adapter chain');
      return next();
    }

    const classification = requestClassification(options);
    const conversationRequest = isConversationRequest(options);
    debug(`classified conversation=${conversationRequest} sessionId=${String(options.sessionId)} system=${classification.hasSystem} purpose=${classification.purpose} frozen=${classification.optionsFrozen}/${classification.messagesFrozen}`);
    if (!conversationRequest) {
      debug('bypassed: not an ordinary frozen agent-loop conversation request');
      return next();
    }

    debug('pruneHistoricalReasoning invoked');
    const messages = pruneHistoricalReasoning(options.messages);
    if (messages === options.messages) {
      debug('pruneHistoricalReasoning returned original messages: no historical reasoning blocks found');
      return next();
    }

    const request = { ...options, messages };
    forwarded.add(request);
    const removed = reasoningBlockCount(options.messages) - reasoningBlockCount(messages);
    const tokens = estimatedTokensRemoved(ctx.tokenMeter, options.messages, messages);
    debug(`pruneHistoricalReasoning removed ${removed} historical reasoning blocks (~${tokens} tokens); re-dispatching cloned request`);
    const session = ctx.sessions?.get(options.sessionId);
    if (session !== undefined) {
      const commandId = randomUUID();
      session.append('command/run', {
        commandId,
        name: 'reasoning-pruner',
        source: { kind: 'user' }
      });
      session.append('command/done', {
        commandId,
        kind: 'success',
        text: `Pruned ${removed} historical reasoning ${removed === 1 ? 'block' : 'blocks'} (~${tokens} tokens) from the model request.`
      });
    }

    // Loop-built requests are frozen and waterfall next() cannot accept replacement options.
    // Re-entering the public runtime with a guarded clone preserves the durable request and log.
    return ctx.llm.stream(request);
  }, { global: true });
}
