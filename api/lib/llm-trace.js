/**
 * LLM Transaction Trace Collector
 *
 * Captures full request/response details for every LLM call in a pipeline run.
 * Each trace records: model, prompts, output, token usage, duration, and tool calls.
 *
 * Usage:
 *   const collector = new TraceCollector();
 *   // pass to agents via adapterConfig.traceCollector
 *   // at end: collector.getTraces()
 */

const crypto = require('crypto');

const PROMPT_TRUNCATE = 8000;
const OUTPUT_TRUNCATE = 8000;

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + `... [truncated, ${str.length} total chars]`;
}

class TraceCollector {
  constructor(requestId) {
    this.requestId = requestId;
    this.traces = [];
    this.startTime = Date.now();
  }

  /**
   * Record a completed LLM transaction.
   */
  record({
    phase,
    agent,
    model,
    duration,
    request,
    response,
    toolCalls,
    cardId,
    cardType,
    error,
  }) {
    const trace = {
      id: crypto.randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      pipelineOffset: Date.now() - this.startTime,
      phase: phase || 'unknown',
      agent: agent || 'unknown',
      model: model || 'unknown',
      duration: duration || 0,

      request: {
        systemPrompt: truncate(request?.systemPrompt, PROMPT_TRUNCATE) || null,
        userPrompt: truncate(request?.userPrompt, PROMPT_TRUNCATE) || null,
        hasImage: !!request?.hasImage,
        imageMediaType: request?.imageMediaType || null,
        maxTokens: request?.maxTokens || null,
      },

      response: {
        text: truncate(response?.text, OUTPUT_TRUNCATE) || null,
        structured: response?.structured || null,
        usage: response?.usage || null,
        stopReason: response?.stopReason || null,
      },

      toolCalls: toolCalls || [],
      cardId: cardId || null,
      cardType: cardType || null,
      error: error || null,
    };

    this.traces.push(trace);
    return trace;
  }

  getTraces() {
    return this.traces;
  }

  getSummary() {
    const byPhase = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalDuration = 0;
    const models = new Set();

    for (const t of this.traces) {
      if (!byPhase[t.phase]) byPhase[t.phase] = { count: 0, duration: 0, errors: 0 };
      byPhase[t.phase].count++;
      byPhase[t.phase].duration += t.duration;
      if (t.error) byPhase[t.phase].errors++;

      if (t.response.usage) {
        totalInputTokens += t.response.usage.input_tokens || 0;
        totalOutputTokens += t.response.usage.output_tokens || 0;
      }
      totalDuration += t.duration;
      models.add(t.model);
    }

    return {
      traceCount: this.traces.length,
      models: [...models],
      totalInputTokens,
      totalOutputTokens,
      totalLlmDuration: totalDuration,
      byPhase,
    };
  }
}

module.exports = { TraceCollector };
