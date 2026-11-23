import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const applications = [
  {
    name: "customer storefront",
    file: "apps/customer-web/vercel.json",
    assetPath: "/assets/:path*",
    requiresGoogleIdentity: true,
    requiresRazorpayCheckout: true,
    requiresMsg91Otp: true,
  },
  {
    name: "vendor panel",
    file: "apps/vendor-panel/vercel.json",
    assetPath: "/vendor/assets/:path*",
  },
  {
    name: "admin panel",
    file: "apps/admin-panel/vercel.json",
    assetPath: "/admin/assets/:path*",
  },
];

for (const application of applications) {
  const config = JSON.parse(await readFile(application.file, "utf8"));
  const broadRule = config.headers?.find((rule) => rule.source === "/(.*)");
  assert.ok(broadRule, `${application.name} must define baseline security headers`);
  const headers = new Map(
    broadRule.headers.map((header) => [header.key.toLowerCase(), header.value]),
  );
  const contentSecurityPolicy = headers.get("content-security-policy");
  assert.ok(contentSecurityPolicy?.includes("default-src 'self'"), `${application.name} must restrict default browser sources`);
  assert.ok(contentSecurityPolicy?.includes("frame-ancestors 'none'"), `${application.name} must disallow framing`);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(
    headers.get("strict-transport-security"),
    "max-age=63072000; includeSubDomains",
    `${application.name} must enforce HTTPS after the first secure visit`,
  );
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.ok(headers.get("permissions-policy"), `${application.name} must limit browser permissions`);
  if (application.requiresGoogleIdentity) {
    assert.ok(contentSecurityPolicy.includes("https://accounts.google.com"), "customer storefront must allow its optional Google Identity provider");
  }
  if (application.requiresRazorpayCheckout) {
    assert.ok(
      contentSecurityPolicy.includes("script-src 'self' https://accounts.google.com https://checkout.razorpay.com"),
      "customer storefront must allow the Razorpay checkout script",
    );
    assert.ok(
      contentSecurityPolicy.includes("frame-src https://accounts.google.com https://checkout.razorpay.com https://api.razorpay.com"),
      "customer storefront must allow Razorpay checkout frames",
    );
  }
  if (application.requiresMsg91Otp) {
    assert.ok(
      contentSecurityPolicy.includes("https://verify.msg91.com https://verify.phone91.com"),
      "customer storefront must allow the MSG91 OTP widget and its fallback origin",
    );
  }

  const assetRule = config.headers?.find((rule) => rule.source === application.assetPath);
  assert.ok(assetRule, `${application.name} must cache fingerprinted assets`);
  assert.equal(
    assetRule.headers.find((header) => header.key === "Cache-Control")?.value,
    "public, max-age=31536000, immutable",
    `${application.name} assets must be immutable at the edge`,
  );
}

const renderBlueprint = await readFile("render.yaml", "utf8");
assert.match(
  renderBlueprint,
  /node apps\/api\/dist\/src\/main\.js/,
  "Render must start the Nest build entry point emitted by the API build",
);
assert.match(
  renderBlueprint,
  /npm run prisma:bootstrap-production --workspace @gyami-global\/api/,
  "Render must provision the configured initial administrator before serving traffic",
);
assert.match(
  renderBlueprint,
  /key: TRUST_PROXY_HOPS\s+value: "1"/,
  "Render must trust only its documented single proxy hop for client IP handling",
);
assert.match(
  renderBlueprint,
  /key: METRICS_AUTH_TOKEN\s+sync: false/,
  "Render must require an operator-supplied metrics scraper token",
);
assert.match(
  renderBlueprint,
  /key: DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION\s+value: AES256/,
  "Render must require encrypted private object uploads",
);
assert.doesNotMatch(
  renderBlueprint,
  /node apps\/api\/dist\/main\.js/,
  "Render must not reference the obsolete API build entry point",
);

const ciWorkflow = await readFile(".github/workflows/ci.yml", "utf8");
assert.match(
  ciWorkflow,
  /uses: actions\/checkout@[a-f0-9]{40}/,
  "CI must pin actions\/checkout to an immutable commit SHA",
);
assert.match(
  ciWorkflow,
  /uses: actions\/setup-node@[a-f0-9]{40}/,
  "CI must pin actions\/setup-node to an immutable commit SHA",
);
assert.match(
  ciWorkflow,
  /persist-credentials: false/,
  "CI must not retain checkout credentials after source retrieval",
);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(
  packageJson.scripts?.["verify:production-readiness"],
  "node scripts/verify-production-readiness.mjs",
  "Operators must retain the non-mutating production readiness verifier",
);

console.log(`Deployment configuration validated for ${applications.length} applications and the API entry point.`);
