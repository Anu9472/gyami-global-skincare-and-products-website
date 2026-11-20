import { Injectable } from "@nestjs/common";

type RequestMetric = {
  count: number;
  durationMs: number;
};

/**
 * Keeps a deliberately small, bounded set of process-local HTTP measurements.
 * These measurements are intended for a Prometheus-compatible scraper; alert
 * history and aggregation belong to the monitoring service rather than the API
 * process, which can be restarted or horizontally scaled at any time.
 */
@Injectable()
export class MetricsService {
  private readonly startedAt = process.hrtime.bigint();
  private readonly requests = new Map<string, RequestMetric>();
  private inFlightRequests = 0;

  requestStarted(): void {
    this.inFlightRequests += 1;
  }

  requestFinished(method: string, statusCode: number, durationMs: number): void {
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
    const normalizedMethod = /^[A-Z]+$/.test(method) ? method : "OTHER";
    const normalizedStatus =
      Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
        ? statusCode
        : 0;
    const key = `${normalizedMethod}:${normalizedStatus}`;
    const metric = this.requests.get(key) ?? { count: 0, durationMs: 0 };
    metric.count += 1;
    metric.durationMs += Math.max(0, durationMs);
    this.requests.set(key, metric);
  }

  renderPrometheus(): string {
    const uptimeSeconds = Number(process.hrtime.bigint() - this.startedAt) / 1_000_000_000;
    const lines = [
      "# HELP gyami_global_process_uptime_seconds Process uptime in seconds.",
      "# TYPE gyami_global_process_uptime_seconds gauge",
      `gyami_global_process_uptime_seconds ${uptimeSeconds.toFixed(3)}`,
      "# HELP gyami_global_http_in_flight_requests HTTP requests currently being processed.",
      "# TYPE gyami_global_http_in_flight_requests gauge",
      `gyami_global_http_in_flight_requests ${this.inFlightRequests}`,
      "# HELP gyami_global_http_requests_total Completed HTTP requests observed by this process.",
      "# TYPE gyami_global_http_requests_total counter",
      "# HELP gyami_global_http_request_duration_milliseconds_sum Total completed HTTP request duration in milliseconds.",
      "# TYPE gyami_global_http_request_duration_milliseconds_sum counter",
      "# HELP gyami_global_http_request_duration_milliseconds_count Completed HTTP requests used to calculate request duration.",
      "# TYPE gyami_global_http_request_duration_milliseconds_count counter",
    ];
    for (const [key, metric] of [...this.requests.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const [method, statusCode] = key.split(":");
      const labels = `{method="${method}",status_code="${statusCode}"}`;
      lines.push(`gyami_global_http_requests_total${labels} ${metric.count}`);
      lines.push(
        `gyami_global_http_request_duration_milliseconds_sum${labels} ${metric.durationMs.toFixed(3)}`,
      );
      lines.push(`gyami_global_http_request_duration_milliseconds_count${labels} ${metric.count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
