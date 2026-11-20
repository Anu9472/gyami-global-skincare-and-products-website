import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { MetricsService } from "../metrics/metrics.service";

const logger = new Logger("HttpAccess");
const SLOW_REQUEST_MS = 1_000;

export function requestPathForLog(originalUrl: string): string {
  return originalUrl.split("?", 1)[0] || "/";
}

export function accessLogSeverity(
  statusCode: number,
  durationMs: number,
): "log" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400 || durationMs >= SLOW_REQUEST_MS) return "warn";
  return "log";
}

/**
 * Emits a compact, machine-readable access record after a response finishes.
 * Query strings are deliberately removed because they can contain search terms,
 * tokens, or other user-provided data.
 */
export function createRequestLoggingMiddleware(metrics?: MetricsService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    let finished = false;
    metrics?.requestStarted();
    response.once("finish", () => {
      finished = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metrics?.requestFinished(request.method, response.statusCode, durationMs);
      const suppliedRequestId: unknown = response.locals.requestId;
      const message = JSON.stringify({
        event: "http_request",
        requestId:
          typeof suppliedRequestId === "string" ? suppliedRequestId : null,
        method: request.method,
        path: requestPathForLog(request.originalUrl),
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        severity: accessLogSeverity(response.statusCode, durationMs),
      });
      switch (accessLogSeverity(response.statusCode, durationMs)) {
        case "error":
          logger.error(message);
          break;
        case "warn":
          logger.warn(message);
          break;
        default:
          logger.log(message);
      }
    });
    response.once("close", () => {
      if (finished) return;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      // 499 is the conventional observability-only status for a client that
      // closed a request before this process could complete its response.
      metrics?.requestFinished(request.method, 499, durationMs);
    });
    next();
  };
}

/** Backward-compatible middleware without process metrics for isolated tests. */
export const requestLoggingMiddleware = createRequestLoggingMiddleware();
