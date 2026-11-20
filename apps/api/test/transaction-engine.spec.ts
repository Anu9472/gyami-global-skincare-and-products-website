import { ConflictException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  Prisma,
  ProductStatus,
  ProductType,
  RefundStatus,
  ShipmentStatus,
  VendorStatus,
} from "@prisma/client";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CheckoutService } from "../src/checkout/checkout.service";
import type { PrismaService } from "../src/database/prisma.service";
import { reserveInventory } from "../src/inventory/reservation-engine";
import { verifyRazorpaySignature } from "../src/payments/payment-provider";
import {
  canConfirmPaymentStatus,
  PaymentsService,
} from "../src/payments/payments.service";
import { calculateCommissionAmount } from "../src/orders/orders.service";
import {
  canApplyShipmentStatus,
  ShipmentsService,
  type ShippingService,
} from "../src/shipments/shipments.service";
import {
  DevelopmentShippingProvider,
  ShiprocketShippingProvider,
} from "../src/shipments/shipping-provider";

function cartCustomer(
  vendorCount: number,
  overrides: {
    vendorStatus?: VendorStatus;
    productStatus?: ProductStatus;
  } = {},
) {
  return {
    id: "customer-id",
    addresses: [{ id: "address-id", pincode: "411001" }],
    cart: {
      items: Array.from({ length: vendorCount }, (_, index) => ({
        id: `cart-${index}`,
        quantity: 2,
        unitPriceSnapshot: new Prisma.Decimal(100 + index),
        product: {
          id: `product-${index}`,
          slug: `product-${index}`,
          name: `Product ${index}`,
          price: new Prisma.Decimal(100 + index),
          gstRate: new Prisma.Decimal(5),
          productType: ProductType.RAW_COMMODITY,
          weightGrams: 500,
          status: overrides.productStatus ?? ProductStatus.APPROVED,
          vendorId: `vendor-${index}`,
          vendor: {
            id: `vendor-${index}`,
            businessName: `Vendor ${index}`,
            status: overrides.vendorStatus ?? VendorStatus.APPROVED,
            pickupPincode: `40000${index}`,
          },
          inventory: {
            id: `inventory-${index}`,
            quantity: 10,
            reserved: 0,
            version: 1,
          },
          images: [],
        },
      })),
    },
  };
}

function checkoutHarness(customer: ReturnType<typeof cartCustomer>) {
  const create = vi.fn().mockResolvedValue({ id: "quote-id" });
  const prisma = {
    customerProfile: { findUnique: vi.fn().mockResolvedValue(customer) },
    checkoutQuote: { create },
  } as unknown as PrismaService;
  const shipping = {
    quote: vi.fn().mockResolvedValue({
      amountMinor: 5000,
      currency: "INR",
      provider: "TEST",
      serviceCode: "STANDARD",
      development: true,
    }),
  } as unknown as ShippingService;
  const config = {
    get: vi.fn((_key: string, fallback: unknown) => fallback),
  } as unknown as ConfigService;
  return { service: new CheckoutService(prisma, shipping, config), create };
}

describe("multi-vendor checkout", () => {
  it("parses development shipping rates loaded from environment strings", async () => {
    const config = {
      get: vi.fn((key: string) =>
        key === "DEV_SHIPPING_BASE_MINOR" ? "4000" : "2000",
      ),
    } as unknown as ConfigService;
    const provider = new DevelopmentShippingProvider(config);
    const rate = await provider.quote({
      originPincode: "444301",
      destinationPincode: "443001",
      weightGrams: 1000,
      cod: true,
    });
    expect(rate.amountMinor).toBe(6000);
    expect(typeof rate.amountMinor).toBe("number");
  });

  it("refreshes an expired Shiprocket token once before returning a quote", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "expired-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "fresh-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              available_courier_companies: [
                { rate: "54.50", courier_company_id: 17, estimated_delivery_days: 3 },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ShiprocketShippingProvider({
      get: vi.fn((key: string) =>
        key === "SHIPROCKET_EMAIL" ? "shipping@example.test" : "secret",
      ),
    } as any);

    try {
      await expect(
        provider.quote({
          originPincode: "411001",
          destinationPincode: "400001",
          weightGrams: 500,
          cod: false,
        }),
      ).resolves.toMatchObject({ amountMinor: 5450, serviceCode: "17" });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer expired-token" },
    });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer fresh-token" },
    });
  });

  it("turns invalid Shiprocket responses into a safe availability failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("upstream gateway error", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ShiprocketShippingProvider({
      get: vi.fn((key: string) =>
        key === "SHIPROCKET_EMAIL" ? "shipping@example.test" : "secret",
      ),
    } as any);

    try {
      await expect(
        provider.quote({
          originPincode: "411001",
          destinationPincode: "400001",
          weightGrams: 500,
          cod: false,
        }),
      ).rejects.toThrow("Shiprocket rate calculation failed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([1, 2, 3])(
    "creates one quote with %i independent vendor groups",
    async (vendorCount) => {
      const { service, create } = checkoutHarness(cartCustomer(vendorCount));
      const quote = await service.validate(
        "user-id",
        "address-id",
        PaymentMethod.COD,
      );
      expect(quote.vendors).toHaveLength(vendorCount);
      expect(quote.totalShipping.amount).toBe(vendorCount * 50);
      expect(create).toHaveBeenCalledOnce();
      const call = create.mock.calls[0] as unknown as [
        { data: { snapshot: { vendors: unknown[] } } },
      ];
      const snapshot = call[0].data.snapshot;
      expect(snapshot.vendors).toHaveLength(vendorCount);
    },
  );

  it("rejects an inactive vendor", async () => {
    const customer = cartCustomer(1, {
      vendorStatus: VendorStatus.SUSPENDED,
    });
    const { service } = checkoutHarness(customer);
    await expect(
      service.validate("user-id", "address-id", PaymentMethod.COD),
    ).rejects.toThrow("is not active");
  });

  it("rejects an unapproved product", async () => {
    const customer = cartCustomer(1, {
      productStatus: ProductStatus.REJECTED,
    });
    const { service } = checkoutHarness(customer);
    await expect(
      service.validate("user-id", "address-id", PaymentMethod.COD),
    ).rejects.toThrow("is not approved");
  });

  it("rejects insufficient available stock", async () => {
    const customer = cartCustomer(1);
    customer.cart.items[0].product.inventory.quantity = 2;
    customer.cart.items[0].product.inventory.reserved = 1;
    const { service } = checkoutHarness(customer);
    await expect(
      service.validate("user-id", "address-id", PaymentMethod.COD),
    ).rejects.toThrow(ConflictException);
  });

  it("requires explicit acceptance after a price change", async () => {
    const customer = cartCustomer(1);
    customer.cart.items[0].product.price = new Prisma.Decimal(120);
    const { service } = checkoutHarness(customer);
    await expect(
      service.validate("user-id", "address-id", PaymentMethod.COD),
    ).rejects.toThrow("price changed");
  });
});

describe("shipment provider event ordering", () => {
  it("does not let delayed scans regress customer-facing shipment status", () => {
    expect(
      canApplyShipmentStatus(
        ShipmentStatus.OUT_FOR_DELIVERY,
        ShipmentStatus.IN_TRANSIT,
      ),
    ).toBe(false);
    expect(
      canApplyShipmentStatus(ShipmentStatus.DELIVERED, ShipmentStatus.PICKED_UP),
    ).toBe(false);
    expect(
      canApplyShipmentStatus(ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED),
    ).toBe(true);
    expect(
      canApplyShipmentStatus(ShipmentStatus.IN_TRANSIT, ShipmentStatus.FAILED),
    ).toBe(true);
  });

  it("returns the existing shipment when a concurrent create wins the unique row", async () => {
    const existing = { id: "shipment-id", vendorOrderId: "vendor-order-id" };
    const create = vi.fn().mockRejectedValue({ code: "P2002" });
    const notifyShipmentStatus = vi.fn();
    const service = new ShipmentsService(
      {
        vendorOrder: {
          findFirst: vi.fn().mockResolvedValue({
            id: "vendor-order-id",
            vendorOrderNumber: "VND-1001",
            orderTotal: new Prisma.Decimal(249),
            vendor: { pickupPincode: "411001" },
            masterOrder: {
              paymentMethod: "COD",
              deliveryAddressSnapshot: {
                recipientName: "Customer",
                mobile: "9876543210",
                line1: "1 Market Road",
                city: "Pune",
                state: "Maharashtra",
                pincode: "411001",
              },
            },
            items: [
              {
                productName: "Organic Mango Pickle",
                productId: "product-id",
                sku: "PICKLE-1",
                quantity: 1,
                unitPrice: new Prisma.Decimal(249),
                product: { weightGrams: 500 },
              },
            ],
            shipment: null,
          }),
        },
        shipment: { create, findUnique: vi.fn().mockResolvedValue(existing) },
      } as any,
      {
        createShipment: vi.fn().mockResolvedValue({
          provider: "SHIPROCKET",
          providerShipmentId: "provider-shipment-id",
          development: false,
        }),
      } as any,
      { get: vi.fn((_key: string, fallback: number) => fallback) } as any,
      { notifyShipmentStatus } as any,
      {} as any,
    );

    await expect(
      service.createForVendorOrder("vendor-user-id", "vendor-order-id"),
    ).resolves.toEqual(existing);
    expect(create).toHaveBeenCalledOnce();
    expect(notifyShipmentStatus).not.toHaveBeenCalled();
  });
});

describe("inventory concurrency", () => {
  it("rejects a stale optimistic inventory version", async () => {
    const create = vi.fn();
    const tx = {
      inventory: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      inventoryTransaction: { create },
    } as unknown as Prisma.TransactionClient;
    await expect(
      reserveInventory(
        tx,
        { id: "inventory", version: 1, quantity: 5, reserved: 0 },
        2,
        "item",
      ),
    ).rejects.toThrow("changed concurrently");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("Razorpay signature verification", () => {
  it("accepts the exact signature and rejects tampering", () => {
    const payload = "order_1|payment_1";
    const secret = "webhook-secret";
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    expect(verifyRazorpaySignature(payload, signature, secret)).toBe(true);
    expect(verifyRazorpaySignature(`${payload}x`, signature, secret)).toBe(
      false,
    );
  });
});

describe("payment session state", () => {
  function pendingOrder() {
    return {
      id: "master-order-id",
      paymentMethod: PaymentMethod.PREPAID,
      status: OrderStatus.PENDING,
      payableTotal: new Prisma.Decimal("249.00"),
      currency: "INR",
      orderNumber: "VN-1001",
    };
  }

  function reservedPayment(status = PaymentStatus.CREATED) {
    return {
      id: "payment-id",
      masterOrderId: "master-order-id",
      provider: "RAZORPAY",
      providerOrderId: null,
      method: PaymentMethod.PREPAID,
      amount: new Prisma.Decimal("249.00"),
      currency: "INR",
      status,
      idempotencyKey: "payment:master-order-id",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("claims a local payment reservation before contacting the provider", async () => {
    const payment = reservedPayment();
    const createOrder = vi.fn().mockResolvedValue({
      id: "order-provider-id",
      amount: 24_900,
      currency: "INR",
    });
    const create = vi.fn().mockResolvedValue(payment);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({
      ...payment,
      status: PaymentStatus.PENDING,
      providerOrderId: "order-provider-id",
    });
    const service = new PaymentsService(
      {
        masterOrder: { findFirst: vi.fn().mockResolvedValue(pendingOrder()) },
        payment: {
          findFirst: vi.fn().mockResolvedValue(null),
          create,
          updateMany,
          update,
        },
      } as unknown as PrismaService,
      { createOrder } as any,
      {} as any,
      { get: vi.fn().mockResolvedValue("rzp_test_public") } as any,
    );

    await expect(
      service.create("customer-user-id", "master-order-id"),
    ).resolves.toMatchObject({
      paymentId: "payment-id",
      providerOrderId: "order-provider-id",
      amountMinor: 24_900,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.CREATED,
          idempotencyKey: "payment:master-order-id",
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PaymentStatus.CREATED,
          providerOrderId: null,
        }),
      }),
    );
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it("does not contact the provider when another request owns session creation", async () => {
    const createOrder = vi.fn();
    const payment = reservedPayment();
    const service = new PaymentsService(
      {
        masterOrder: { findFirst: vi.fn().mockResolvedValue(pendingOrder()) },
        payment: {
          findFirst: vi.fn().mockResolvedValue(payment),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn().mockResolvedValue({
            ...payment,
            status: PaymentStatus.PENDING,
          }),
        },
      } as unknown as PrismaService,
      { createOrder } as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.create("customer-user-id", "master-order-id"),
    ).rejects.toThrow("Payment session is being created");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("releases a reservation after a provider-session failure so it can be retried", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const service = new PaymentsService(
      {
        masterOrder: { findFirst: vi.fn().mockResolvedValue(pendingOrder()) },
        payment: {
          findFirst: vi.fn().mockResolvedValue(reservedPayment()),
          updateMany,
        },
      } as unknown as PrismaService,
      { createOrder: vi.fn().mockRejectedValue(new Error("Razorpay unavailable")) } as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.create("customer-user-id", "master-order-id"),
    ).rejects.toThrow("Razorpay unavailable");
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.CREATED,
          failureReason: expect.stringContaining("retry"),
        }),
      }),
    );
  });

  it("only confirms payments that are awaiting capture", () => {
    expect(canConfirmPaymentStatus(PaymentStatus.CREATED)).toBe(true);
    expect(canConfirmPaymentStatus(PaymentStatus.AUTHORIZED)).toBe(true);
    expect(canConfirmPaymentStatus(PaymentStatus.FAILED)).toBe(false);
    expect(canConfirmPaymentStatus(PaymentStatus.CANCELLED)).toBe(false);
    expect(canConfirmPaymentStatus(PaymentStatus.REFUNDED)).toBe(false);
  });

  it("does not open another payment session after an order has progressed", async () => {
    const createOrder = vi.fn();
    const service = new PaymentsService(
      {
        masterOrder: {
          findFirst: vi.fn().mockResolvedValue({
            id: "master-order-id",
            paymentMethod: PaymentMethod.PREPAID,
            status: OrderStatus.CONFIRMED,
          }),
        },
      } as unknown as PrismaService,
      { createOrder } as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.create("customer-user-id", "master-order-id"),
    ).rejects.toThrow("only available while the order is awaiting payment");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("does not let a late refund failure overwrite a completed refund", async () => {
    const update = vi.fn();
    const service = new PaymentsService(
      {
        refund: {
          findUnique: vi.fn().mockResolvedValue({
            id: "refund-id",
            status: RefundStatus.COMPLETED,
          }),
          update,
        },
      } as unknown as PrismaService,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).handleRefundFailed({
      payload: { refund: { entity: { id: "provider-refund-id" } } },
    });

    expect(update).not.toHaveBeenCalled();
  });
});

describe("commission calculation", () => {
  it("rounds the backend commission snapshot to paise", () => {
    expect(
      calculateCommissionAmount(
        new Prisma.Decimal("999.99"),
        new Prisma.Decimal("7.5"),
      ).toString(),
    ).toBe("75");
  });
});
