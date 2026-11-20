type Environment = Record<string, string | undefined>;

export function validateEnvironment(input: Environment): Environment {
  const environment = input.NODE_ENV ?? "development";
  const customerWebUrl = input.CUSTOMER_WEB_URL ?? "http://localhost:5173";
  const documentStorageProvider =
    input.DOCUMENT_STORAGE_PROVIDER ??
    (environment === "production" ? "s3" : "local");
  const documentStorageServerSideEncryption =
    input.DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION ?? "AES256";
  const shippingProvider = (
    input.SHIPPING_PROVIDER ??
    (environment === "production" ? "SHIPROCKET" : "DEVELOPMENT")
  ).toUpperCase();
  const whatsappProvider = (
    input.WHATSAPP_PROVIDER ??
    (environment === "production" ? "INTERAKT" : "DEVELOPMENT")
  ).toUpperCase();
  const smsProvider = (
    input.SMS_PROVIDER ??
    (environment === "production" ? "MSG91" : "UNCONFIGURED")
  ).toUpperCase();
  const trustProxyHops = input.TRUST_PROXY_HOPS ??
    (environment === "production" ? "1" : "0");
  const required = [
    "DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "BANK_DATA_ENCRYPTION_KEY",
    "CORS_ORIGINS",
  ];
  const missing = required.filter((key) => !input[key]);
  if (missing.length > 0)
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  if (
    (input.JWT_ACCESS_SECRET?.length ?? 0) < 32 ||
    (input.JWT_REFRESH_SECRET?.length ?? 0) < 32
  ) {
    throw new Error("JWT secrets must each contain at least 32 characters");
  }
  const encryptionKey = input.BANK_DATA_ENCRYPTION_KEY ?? "";
  const encryptionKeyBytes = /^[a-fA-F0-9]{64}$/.test(encryptionKey)
    ? Buffer.from(encryptionKey, "hex")
    : Buffer.from(encryptionKey, "base64");
  if (encryptionKeyBytes.length !== 32)
    throw new Error(
      "BANK_DATA_ENCRYPTION_KEY must be 64 hexadecimal characters or a Base64-encoded 32-byte key",
    );
  if (environment === "production" && input.CORS_ORIGINS?.includes("*")) {
    throw new Error("Wildcard CORS is prohibited in production");
  }
  const corsOrigins = input.CORS_ORIGINS!.split(",").map((origin) =>
    origin.trim(),
  );
  if (!corsOrigins.length || corsOrigins.some((origin) => !isExactOrigin(origin))) {
    throw new Error("CORS_ORIGINS must contain valid web origins");
  }
  if (
    environment === "production" &&
    corsOrigins.some((origin) => !origin.startsWith("https://"))
  ) {
    throw new Error("Production CORS origins must use HTTPS");
  }
  if (input.THROTTLE_REDIS_URL && !isRedisUrl(input.THROTTLE_REDIS_URL)) {
    throw new Error("THROTTLE_REDIS_URL must be a redis or rediss URL");
  }
  if (documentStorageProvider !== "local" && documentStorageProvider !== "s3") {
    throw new Error("DOCUMENT_STORAGE_PROVIDER must be local or s3");
  }
  if (environment === "production" && documentStorageProvider !== "s3") {
    throw new Error(
      "Production requires S3-compatible private document storage",
    );
  }
  if (
    documentStorageProvider === "s3" &&
    (!input.DOCUMENT_STORAGE_S3_BUCKET || !input.DOCUMENT_STORAGE_S3_REGION)
  ) {
    throw new Error(
      "S3 document storage requires DOCUMENT_STORAGE_S3_BUCKET and DOCUMENT_STORAGE_S3_REGION",
    );
  }
  if (
    !new Set(["AES256", "aws:kms", "aws:kms:dsse"]).has(
      documentStorageServerSideEncryption,
    )
  ) {
    throw new Error(
      "DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION must be AES256, aws:kms, or aws:kms:dsse",
    );
  }
  if (
    input.DOCUMENT_STORAGE_S3_KMS_KEY_ID &&
    !new Set(["aws:kms", "aws:kms:dsse"]).has(
      documentStorageServerSideEncryption,
    )
  ) {
    throw new Error(
      "DOCUMENT_STORAGE_S3_KMS_KEY_ID requires aws:kms or aws:kms:dsse encryption",
    );
  }
  if (
    Boolean(input.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID) !==
    Boolean(input.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      "S3 document storage credentials require both access key ID and secret access key",
    );
  }
  if (environment === "production" && !input.THROTTLE_REDIS_URL) {
    throw new Error("THROTTLE_REDIS_URL is required in production");
  }
  if (
    environment === "production" &&
    (input.METRICS_AUTH_TOKEN?.length ?? 0) < 32
  ) {
    throw new Error(
      "METRICS_AUTH_TOKEN must contain at least 32 characters in production",
    );
  }
  if (!new Set(["DEVELOPMENT", "SHIPROCKET"]).has(shippingProvider)) {
    throw new Error("SHIPPING_PROVIDER must be DEVELOPMENT or SHIPROCKET");
  }
  if (environment === "production" && shippingProvider === "DEVELOPMENT") {
    throw new Error("The development shipping simulator is prohibited in production");
  }
  if (!new Set(["DEVELOPMENT", "INTERAKT"]).has(whatsappProvider)) {
    throw new Error("WHATSAPP_PROVIDER must be DEVELOPMENT or INTERAKT");
  }
  if (environment === "production" && whatsappProvider === "DEVELOPMENT") {
    throw new Error("The development WhatsApp simulator is prohibited in production");
  }
  if (!new Set(["UNCONFIGURED", "MSG91"]).has(smsProvider)) {
    throw new Error("SMS_PROVIDER must be UNCONFIGURED or MSG91");
  }
  if (environment === "production" && smsProvider !== "MSG91") {
    throw new Error("SMS_PROVIDER must be MSG91 in production");
  }
  if (!/^\d+$/.test(trustProxyHops) || Number(trustProxyHops) > 5) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 5");
  }
  return {
    ...input,
    NODE_ENV: environment,
    PORT: input.PORT ?? "4000",
    JWT_ACCESS_TTL: input.JWT_ACCESS_TTL ?? "15m",
    JWT_REFRESH_TTL: input.JWT_REFRESH_TTL ?? "30d",
    PRIVATE_UPLOAD_DIR: input.PRIVATE_UPLOAD_DIR ?? "./private-uploads",
    DOCUMENT_STORAGE_PROVIDER: documentStorageProvider,
    DOCUMENT_STORAGE_S3_BUCKET: input.DOCUMENT_STORAGE_S3_BUCKET,
    DOCUMENT_STORAGE_S3_REGION: input.DOCUMENT_STORAGE_S3_REGION,
    DOCUMENT_STORAGE_S3_ENDPOINT: input.DOCUMENT_STORAGE_S3_ENDPOINT,
    DOCUMENT_STORAGE_S3_FORCE_PATH_STYLE:
      input.DOCUMENT_STORAGE_S3_FORCE_PATH_STYLE ?? "false",
    DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION:
      documentStorageServerSideEncryption,
    DOCUMENT_STORAGE_S3_KMS_KEY_ID: input.DOCUMENT_STORAGE_S3_KMS_KEY_ID,
    DOCUMENT_STORAGE_S3_ACCESS_KEY_ID:
      input.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID,
    DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY:
      input.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY,
    PUBLIC_UPLOAD_DIR: input.PUBLIC_UPLOAD_DIR ?? "./public-uploads",
    MAX_UPLOAD_BYTES: input.MAX_UPLOAD_BYTES ?? "5242880",
    SETTLEMENT_DAYS: input.SETTLEMENT_DAYS ?? "7",
    RETURN_WINDOW_DAYS: input.RETURN_WINDOW_DAYS ?? "7",
    CHECKOUT_QUOTE_TTL_MINUTES: input.CHECKOUT_QUOTE_TTL_MINUTES ?? "10",
    PASSWORD_RESET_TTL_MINUTES: input.PASSWORD_RESET_TTL_MINUTES ?? "30",
    LOGIN_MAX_FAILURES: input.LOGIN_MAX_FAILURES ?? "5",
    LOGIN_LOCK_MINUTES: input.LOGIN_LOCK_MINUTES ?? "15",
    OTP_TTL_MINUTES: input.OTP_TTL_MINUTES ?? "10",
    OTP_RESEND_COOLDOWN_SECONDS:
      input.OTP_RESEND_COOLDOWN_SECONDS ?? "30",
    THROTTLE_REDIS_URL: input.THROTTLE_REDIS_URL,
    METRICS_AUTH_TOKEN: input.METRICS_AUTH_TOKEN,
    TRUST_PROXY_HOPS: trustProxyHops,
    ENABLE_SWAGGER:
      input.ENABLE_SWAGGER ?? (environment === "production" ? "false" : "true"),
    CUSTOMER_WEB_URL: customerWebUrl,
    VENDOR_WEB_URL:
      input.VENDOR_WEB_URL ??
      (environment === "production"
        ? `${customerWebUrl.replace(/\/$/, "")}/vendor`
        : "http://localhost:5174"),
    SHIPPING_PROVIDER: shippingProvider,
    WHATSAPP_PROVIDER: whatsappProvider,
    SMS_PROVIDER: smsProvider,
    MSG91_API_URL:
      input.MSG91_API_URL ?? "https://control.msg91.com/api/v5/otp",
    MSG91_DEFAULT_COUNTRY_CODE: input.MSG91_DEFAULT_COUNTRY_CODE ?? "91",
    DEV_SHIPPING_BASE_MINOR: input.DEV_SHIPPING_BASE_MINOR ?? "4000",
    DEV_SHIPPING_PER_KG_MINOR: input.DEV_SHIPPING_PER_KG_MINOR ?? "2000",
  };
}

function isExactOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "redis:" || url.protocol === "rediss:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}
