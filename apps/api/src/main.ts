import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { createRequestLoggingMiddleware } from "./common/request-logging.middleware";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { ResponseInterceptor } from "./common/response.interceptor";
import { noStoreAuthorizedResponseMiddleware } from "./common/no-store-authorized-response.middleware";
import { MetricsService } from "./metrics/metrics.service";

type ProxyConfigurableHttpServer = {
  set(setting: "trust proxy", hops: number): void;
};

function hasProxyConfiguration(
  value: unknown,
): value is ProxyConfigurableHttpServer {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "set" in value &&
    typeof value.set === "function"
  );
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const metrics = app.get(MetricsService);
  const trustProxyHops = Number(config.get<string>("TRUST_PROXY_HOPS", "0"));
  if (trustProxyHops > 0) {
    const httpServer: unknown = app.getHttpAdapter().getInstance();
    if (!hasProxyConfiguration(httpServer)) {
      throw new Error("HTTP server does not support trusted proxy configuration");
    }
    httpServer.set("trust proxy", trustProxyHops);
  }
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.use(requestIdMiddleware);
  app.use(noStoreAuthorizedResponseMiddleware);
  app.use(createRequestLoggingMiddleware(metrics));
  app.enableCors({
    origin: config
      .getOrThrow<string>("CORS_ORIGINS")
      .split(",")
      .map((origin) => origin.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  if (config.get<string>("ENABLE_SWAGGER") === "true") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("GYAMI Global Platform API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      "api/docs",
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  await app.listen(config.get<number>("PORT", 4000));
}

void bootstrap();
