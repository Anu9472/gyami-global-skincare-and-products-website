import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
  UnauthorizedException,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { MetricsService } from "./metrics.service";

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export function metricsTokenMatches(
  suppliedToken: string | undefined,
  configuredToken: string,
): boolean {
  if (!suppliedToken) return false;
  const supplied = Buffer.from(suppliedToken);
  const configured = Buffer.from(configuredToken);
  return (
    supplied.length === configured.length &&
    timingSafeEqual(supplied, configured)
  );
}

@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  @ApiExcludeEndpoint()
  @Header("Cache-Control", "no-store")
  metricsEndpoint(
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const configuredToken = this.config.get<string>("METRICS_AUTH_TOKEN");
    if (!configuredToken) {
      if (this.config.get<string>("NODE_ENV") === "production") {
        throw new ServiceUnavailableException("Metrics authentication is unavailable");
      }
    } else if (
      !metricsTokenMatches(request.header("x-metrics-token"), configuredToken)
    ) {
      throw new UnauthorizedException("Metrics authentication failed");
    }
    response
      .type(PROMETHEUS_CONTENT_TYPE)
      .send(this.metrics.renderPrometheus());
  }
}
