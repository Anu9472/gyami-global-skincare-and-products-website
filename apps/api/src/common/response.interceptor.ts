import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { Observable, map } from "rxjs";

export interface ApiResult<T> {
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T | ApiResult<T>>,
  ): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = response.locals.requestId as string | undefined;
    return next.handle().pipe(
      map((value) => {
        if (value instanceof StreamableFile) return value;
        if (value && typeof value === "object" && "data" in value) {
          const result = value;
          return {
            success: true,
            data: result.data,
            message: result.message ?? "Operation successful",
            meta: { ...result.meta, ...(requestId ? { requestId } : {}) },
          };
        }
        return {
          success: true,
          data: value ?? null,
          message: "Operation successful",
          meta: requestId ? { requestId } : {},
        };
      }),
    );
  }
}
