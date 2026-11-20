import type { NextFunction, Request, Response } from "express";

/**
 * Bearer-authenticated API responses are account-specific. Mark them as
 * non-cacheable before the route handler runs; explicit public cache headers
 * on catalogue/media routes may still replace this for public content.
 */
export function noStoreAuthorizedResponseMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.header("authorization")?.trim()) {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
}
