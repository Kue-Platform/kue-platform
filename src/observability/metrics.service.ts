import { Injectable } from '@nestjs/common';

interface MetricLabels {
  [key: string]: string;
}

@Injectable()
export class MetricsService {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  incrementCounter(name: string, labels?: MetricLabels, value = 1): void {
    const key = this.buildKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  recordHistogram(name: string, value: number, labels?: MetricLabels): void {
    const key = this.buildKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
  }

  recordApiLatency(route: string, method: string, statusCode: number, latencyMs: number): void {
    this.recordHistogram('api.request.duration_ms', latencyMs, { route, method, status: String(statusCode) });
    this.incrementCounter('api.request.count', { route, method, status: String(statusCode) });
  }

  recordNeo4jLatency(queryType: string, latencyMs: number): void {
    this.recordHistogram('neo4j.query.duration_ms', latencyMs, { queryType });
    this.incrementCounter('neo4j.query.count', { queryType });
  }

  recordCacheHit(): void {
    this.incrementCounter('redis.cache.hits');
  }

  recordCacheMiss(): void {
    this.incrementCounter('redis.cache.misses');
  }

  recordJobDuration(jobName: string, durationMs: number): void {
    this.recordHistogram('inngest.job.duration_ms', durationMs, { jobName });
  }

  recordJobFailure(jobName: string): void {
    this.incrementCounter('inngest.job.failures', { jobName });
  }

  recordLlmRequest(
    operation: string,
    durationMs: number,
    success: boolean,
    tokens?: number,
    costUsd?: number,
  ): void {
    this.recordHistogram('llm.request.duration_ms', durationMs, { operation, success: String(success) });
    this.incrementCounter('llm.request.count', { operation, success: String(success) });
    if (tokens !== undefined) {
      this.incrementCounter('llm.request.tokens', { operation }, tokens);
    }
    if (costUsd !== undefined) {
      this.incrementCounter('llm.request.cost_usd', { operation }, costUsd);
    }
  }

  private buildKey(name: string, labels?: MetricLabels): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }
}
