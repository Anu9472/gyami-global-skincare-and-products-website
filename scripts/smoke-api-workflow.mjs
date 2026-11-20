import { readFile } from "node:fs/promises";

const execute = process.argv.includes("--execute");
const baseUrl = process.env.GYAMI_GLOBAL_API_URL ?? "http://127.0.0.1:4000/api/v1";
const parsedBaseUrl = new URL(baseUrl);

if (!execute) {
  throw new Error("Refusing to mutate data. Re-run with --execute.");
}
if (!["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname)) {
  throw new Error("The local workflow smoke test only permits a localhost API URL.");
}

async function request(path, { token, method = "GET", body, form } = {}) {
  const response = await fetch(new URL(path, `${baseUrl.replace(/\/$/, "")}/`), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${payload?.message ?? "invalid response"}`,
    );
  }
  return payload.data;
}

async function assertOptimizedProductImage(imageUrl) {
  const response = await fetch(
    new URL(imageUrl, `${baseUrl.replace(/\/api\/v1$/, "")}/`),
  );
  if (!response.ok) {
    throw new Error(`Uploaded product image could not be read (${response.status})`);
  }
  if (!response.headers.get("content-type")?.startsWith("image/webp")) {
    throw new Error("Uploaded product image was not optimized to WebP");
  }
  if (!response.headers.get("cache-control")?.includes("immutable")) {
    throw new Error("Uploaded product image is missing immutable cache headers");
  }
}

async function signIn(email) {
  const session = await request("auth/login", {
    method: "POST",
    body: { emailOrMobile: email, password: "Demo@12345Secure" },
  });
  return session.accessToken;
}

async function main() {
  const health = await request("health");
  if (health.status !== "ok" || health.database !== "connected") {
    throw new Error("Local API health check did not confirm database connectivity");
  }
  const metricsResponse = await fetch(
    new URL("metrics", `${baseUrl.replace(/\/$/, "")}/`),
  );
  const metrics = await metricsResponse.text();
  if (
    !metricsResponse.ok ||
    !metricsResponse.headers
      .get("content-type")
      ?.includes("text/plain") ||
    !metrics.includes("gyami_global_process_uptime_seconds") ||
    !metrics.includes("gyami_global_http_requests_total")
  ) {
    throw new Error("Local API metrics endpoint did not return Prometheus metrics");
  }
  const heroResponse = await fetch(
    new URL("home-hero-slides", `${baseUrl.replace(/\/$/, "")}/`),
  );
  const heroPayload = await heroResponse.json().catch(() => null);
  if (
    !heroResponse.ok ||
    heroPayload?.success !== true ||
    !heroResponse.headers.get("cache-control")?.includes("stale-while-revalidate") ||
    !heroResponse.headers.get("cdn-cache-control")?.includes("s-maxage=60") ||
    !heroResponse.headers
      .get("vercel-cdn-cache-control")
      ?.includes("s-maxage=60")
  ) {
    throw new Error("Homepage hero endpoint is missing its public edge-cache policy");
  }

  const [customerToken, vendorToken, adminToken] = await Promise.all([
    signIn("customer@gyami_global.test"),
    signIn("vendor@gyami_global.test"),
    signIn("admin@gyami_global.test"),
  ]);
  const [addresses, products, categories] = await Promise.all([
    request("customers/me/addresses", { token: customerToken }),
    request("products?search=Organic%20Mango%20Pickle&limit=100"),
    request("categories"),
  ]);
  const address = addresses[0];
  // Never rely on newest-first catalogue ordering: earlier manual or failed
  // smoke data can legitimately exist in a local development database.
  const product = products.find(
    (candidate) => candidate.slug === "organic-mango-pickle-demo",
  );
  const category = categories[0];
  if (!address?.id || !product?.id || !category?.id) {
    throw new Error(
      "Local test seed is missing a customer address, approved product, or category",
    );
  }

  await request("cart/items", {
    token: customerToken,
    method: "POST",
    body: { productId: product.id, quantity: 1 },
  });
  const quote = await request("checkout/validate", {
    token: customerToken,
    method: "POST",
    body: { addressId: address.id, paymentMethod: "COD" },
  });
  const order = await request("orders", {
    token: customerToken,
    method: "POST",
    body: {
      quoteId: quote.quoteId,
      addressId: address.id,
      paymentMethod: "COD",
    },
  });
  const vendorOrderId = order.vendorOrders?.[0]?.id;
  if (!vendorOrderId) throw new Error("Created order has no vendor order");

  const vendorOrder = await request(`vendor/orders/${vendorOrderId}`, {
    token: vendorToken,
  });
  if (vendorOrder.status === "PENDING") {
    await request(`vendor/orders/${vendorOrderId}/status`, {
      token: vendorToken,
      method: "PATCH",
      body: { status: "CONFIRMED" },
    });
  }

  const [customerOrders, vendorOrders, adminOrders] = await Promise.all([
    request("orders", { token: customerToken }),
    request("vendor/orders", { token: vendorToken }),
    request("admin/orders", { token: adminToken }),
  ]);
  const customerCanSee = customerOrders.some(
    (candidate) => candidate.masterOrderId === order.masterOrderId,
  );
  const vendorCanSee = vendorOrders.some((candidate) => candidate.id === vendorOrderId);
  const adminCanSee = adminOrders.some(
    (candidate) =>
      candidate.id === order.masterOrderId || candidate.masterOrderId === order.masterOrderId,
  );
  if (!customerCanSee || !vendorCanSee || !adminCanSee) {
    throw new Error(
      `Order visibility failed: customer=${customerCanSee}, vendor=${vendorCanSee}, admin=${adminCanSee}`,
    );
  }

  const productName = `Workflow smoke product ${Date.now()}`;
  const vendorProduct = await request("vendor/products", {
    token: vendorToken,
    method: "POST",
    body: {
      categoryId: category.id,
      name: productName,
      description:
        "A local workflow smoke-test product used to verify vendor submission and admin review.",
      productType: "VALUE_ADDED",
      price: 199,
      mrp: 249,
      gstRate: 5,
      weightGrams: 500,
      ingredients: "Millets, spices",
      specifications: { quality: "Smoke-test only", pack: "500 g" },
      stock: 10,
    },
  });
  const sourceImage = await readFile(
    new URL("../apps/api/product-image-sources/organic-mango-pickle.png", import.meta.url),
  );
  const upload = new FormData();
  upload.append(
    "images",
    new Blob([sourceImage], { type: "image/png" }),
    "workflow-product.png",
  );
  const uploadedProduct = await request(`vendor/products/${vendorProduct.id}/images`, {
    token: vendorToken,
    method: "POST",
    form: upload,
  });
  if (!uploadedProduct.images?.[0]?.url) {
    throw new Error("Vendor product image upload did not return an image URL");
  }
  await assertOptimizedProductImage(uploadedProduct.images[0].url);

  const submittedProduct = await request(
    `vendor/products/${vendorProduct.id}/submit`,
    { token: vendorToken, method: "POST" },
  );
  if (submittedProduct.status !== "PENDING_APPROVAL") {
    throw new Error("Vendor product was not placed in the admin approval queue");
  }
  const adminProducts = await request("admin/products?limit=100", {
    token: adminToken,
  });
  const pendingProduct = adminProducts.find(
    (candidate) => candidate.id === vendorProduct.id,
  );
  if (pendingProduct?.status !== "PENDING_APPROVAL") {
    throw new Error("Admin cannot see the vendor product awaiting approval");
  }
  const approvedProduct = await request(
    `admin/products/${vendorProduct.id}/approve`,
    { token: adminToken, method: "POST" },
  );
  if (approvedProduct.status !== "APPROVED") {
    throw new Error("Admin product approval did not complete");
  }
  const [publishedProducts, vendorNotifications] = await Promise.all([
    request(`products?search=${encodeURIComponent(productName)}`),
    request("notifications", { token: vendorToken }),
  ]);
  if (!publishedProducts.some((candidate) => candidate.id === vendorProduct.id)) {
    throw new Error("Approved vendor product is not visible in the storefront");
  }
  const approvalNotification = vendorNotifications.find(
    (notification) =>
      notification.templateKey === "PRODUCT_APPROVED" &&
      notification.payload?.productId === vendorProduct.id,
  );
  if (!approvalNotification) {
    throw new Error("Vendor did not receive the product approval notification");
  }
  // Keep the local smoke catalogue clean after verifying the full workflow.
  await request(`vendor/products/${vendorProduct.id}`, {
    token: vendorToken,
    method: "DELETE",
  });

  console.log(
    JSON.stringify(
      {
        status: "passed",
        orderNumber: order.masterOrderNumber,
        paymentStatus: order.paymentStatus,
        customerCanSee,
        vendorCanSee,
        adminCanSee,
        vendorProductApprovalFlow: true,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
