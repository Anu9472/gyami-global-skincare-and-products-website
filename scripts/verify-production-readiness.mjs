const baseUrl = process.env.GYAMI_GLOBAL_PRODUCTION_API_URL;
const metricsToken = process.env.METRICS_AUTH_TOKEN;
const timeoutMs = 10_000;

if (!baseUrl) {
  throw new Error("Set GYAMI_GLOBAL_PRODUCTION_API_URL to the deployed API base URL");
}
const parsedBaseUrl = new URL(baseUrl);
if (parsedBaseUrl.protocol !== "https:") {
  throw new Error("GYAMI_GLOBAL_PRODUCTION_API_URL must use HTTPS");
}
if ((metricsToken?.length ?? 0) < 32) {
  throw new Error("METRICS_AUTH_TOKEN must contain at least 32 characters");
}

function endpoint(path) {
  return new URL(path, `${parsedBaseUrl.toString().replace(/\/$/, "")}/`);
}

async function fetchWithTimeout(path, options = {}) {
  return fetch(endpoint(path), {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function assertHealth(path) {
  const response = await fetchWithTimeout(path);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true || payload?.data?.status !== "ok") {
    throw new Error(`${path} did not report ready status (HTTP ${response.status})`);
  }
  return response.headers.get("x-request-id") ?? null;
}

async function main() {
  const [readinessRequestId, launchRequestId] = await Promise.all([
    assertHealth("health/ready"),
    assertHealth("health/launch"),
  ]);
  const metricsResponse = await fetchWithTimeout("metrics", {
    headers: { "X-Metrics-Token": metricsToken },
  });
  const metrics = await metricsResponse.text();
  if (
    !metricsResponse.ok ||
    !metricsResponse.headers.get("content-type")?.includes("text/plain") ||
    !metricsResponse.headers.get("cache-control")?.includes("no-store") ||
    !metrics.includes("gyami_global_process_uptime_seconds") ||
    !metrics.includes("gyami_global_http_requests_total")
  ) {
    throw new Error(`metrics endpoint validation failed (HTTP ${metricsResponse.status})`);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        readinessRequestId,
        launchRequestId,
        metricsRequestId: metricsResponse.headers.get("x-request-id") ?? null,
      },
      null,
      2,
    ),
  );
}

await main();
