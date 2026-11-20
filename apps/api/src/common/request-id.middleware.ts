import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function createRequestId(value: unknown): string {
  const supplied =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : undefined;
  return supplied && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : randomUUID();
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = createRequestId(request.headers["x-request-id"]);
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  next();
}
