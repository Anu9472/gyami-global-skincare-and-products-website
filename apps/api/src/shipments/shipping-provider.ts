import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { IntegrationSettingsService } from "../integration-settings/integration-settings.service";

export interface ShippingRateInput {
  originPincode: string;
  destinationPincode: string;
  weightGrams: number;
  cod: boolean;
}
export interface ShippingRate {
  amountMinor: number;
  currency: "INR";
  provider: string;
  serviceCode: string;
  estimatedDays?: number;
  development: boolean;
}
export interface ShipmentCreateInput {
  idempotencyKey: string;
  vendorOrderNumber: string;
  originPincode: string;
  destination: {
    name: string;
    mobile: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  weightGrams: number;
  amountMinor: number;
  cod: boolean;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
  }>;
}
export interface ShipmentCreateResult {
  provider: string;
  providerShipmentId: string;
  awb?: string;
  trackingUrl?: string;
  development: boolean;
}
export interface ShippingProvider {
  quote(input: ShippingRateInput): Promise<ShippingRate>;
  createShipment(input: ShipmentCreateInput): Promise<ShipmentCreateResult>;
  createReturnShipment(
    input: ShipmentCreateInput,
  ): Promise<ShipmentCreateResult>;
}

export class DevelopmentShippingProvider implements ShippingProvider {
  constructor(private readonly config: ConfigService) {}
  quote(input: ShippingRateInput): Promise<ShippingRate> {
    const base = Number(
      this.config.get<string | number>("DEV_SHIPPING_BASE_MINOR", 4000),
    );
    const perKg = Number(
      this.config.get<string | number>("DEV_SHIPPING_PER_KG_MINOR", 2000),
    );
    if (!Number.isFinite(base) || !Number.isFinite(perKg))
      throw new ServiceUnavailableException(
        "Development shipping rates are invalid",
      );
    return Promise.resolve({
      amountMinor: base + Math.ceil(input.weightGrams / 1000) * perKg,
      currency: "INR",
      provider: "DEVELOPMENT",
      serviceCode: "DEV_STANDARD",
      estimatedDays: 5,
      development: true,
    });
  }
  createShipment(input: ShipmentCreateInput): Promise<ShipmentCreateResult> {
    return Promise.resolve({
      provider: "DEVELOPMENT",
      providerShipmentId: `DEV-${input.idempotencyKey}`,
      development: true,
    });
  }
  createReturnShipment(
    input: ShipmentCreateInput,
  ): Promise<ShipmentCreateResult> {
    return Promise.resolve({
      provider: "DEVELOPMENT",
      providerShipmentId: `DEV-RETURN-${input.idempotencyKey}`,
      development: true,
    });
  }
}

export class ShiprocketShippingProvider implements ShippingProvider {
  private static readonly TOKEN_CACHE_MS = 10 * 60_000;
  private token?: string;
  private credentialFingerprint?: string;
  private tokenExpiresAt = 0;
  constructor(private readonly settings: IntegrationSettingsService) {}

  private clearToken() {
    this.token = undefined;
    this.credentialFingerprint = undefined;
    this.tokenExpiresAt = 0;
  }

  private async requestJson(
    url: string,
    options: RequestInit,
    failureMessage: string,
  ): Promise<{ response: Response; body: unknown }> {
    let response: Response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new ServiceUnavailableException(failureMessage);
    }
    try {
      return { response, body: (await response.json()) as unknown };
    } catch {
      throw new ServiceUnavailableException(failureMessage);
    }
  }

  private async authorizedRequest(
    url: string,
    options: Omit<RequestInit, "headers"> & {
      headers?: Record<string, string>;
    },
    failureMessage: string,
  ): Promise<{ response: Response; body: unknown }> {
    const send = async (token: string) =>
      this.requestJson(
        url,
        {
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${token}` },
        },
        failureMessage,
      );

    let result = await send(await this.authToken());
    // Shiprocket access tokens are short-lived. A single refresh makes an
    // in-flight token expiry transparent without retrying arbitrary failures.
    if (result.response.status === 401) {
      this.clearToken();
      result = await send(await this.authToken());
    }
    return result;
  }

  private async authToken(): Promise<string> {
    const [email, password] = await Promise.all([
      this.settings.get("SHIPROCKET_EMAIL"),
      this.settings.get("SHIPROCKET_PASSWORD"),
    ]);
    if (!email || !password)
      throw new ServiceUnavailableException(
        "Shiprocket credentials are not configured",
      );
    const fingerprint = createHash("sha256")
      .update(`${email}\0${password}`)
      .digest("hex");
    if (
      this.token &&
      this.credentialFingerprint === fingerprint &&
      Date.now() < this.tokenExpiresAt
    ) {
      return this.token;
    }
    const { response, body } = await this.requestJson(
      "https://apiv2.shiprocket.in/v1/external/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      },
      "Shiprocket authentication failed",
    );
    if (
      !response.ok ||
      !body ||
      typeof body !== "object" ||
      !("token" in body) ||
      typeof body.token !== "string" ||
      !body.token
    ) {
      throw new ServiceUnavailableException("Shiprocket authentication failed");
    }
    this.token = body.token;
    this.credentialFingerprint = fingerprint;
    this.tokenExpiresAt = Date.now() + ShiprocketShippingProvider.TOKEN_CACHE_MS;
    return this.token;
  }
  async quote(input: ShippingRateInput): Promise<ShippingRate> {
    const query = new URLSearchParams({
      pickup_postcode: input.originPincode,
      delivery_postcode: input.destinationPincode,
      weight: (input.weightGrams / 1000).toFixed(3),
      cod: input.cod ? "1" : "0",
    });
    const { response, body } = await this.authorizedRequest(
      `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${query}`,
      {
        headers: {},
        signal: AbortSignal.timeout(10_000),
      },
      "Shiprocket rate calculation failed",
    );
    if (!response.ok || !body || typeof body !== "object" || !("data" in body))
      throw new ServiceUnavailableException(
        "Shiprocket rate calculation failed",
      );
    const data = body.data;
    if (
      !data ||
      typeof data !== "object" ||
      !("available_courier_companies" in data) ||
      !Array.isArray(data.available_courier_companies) ||
      data.available_courier_companies.length === 0
    )
      throw new ServiceUnavailableException(
        "No Shiprocket courier is available",
      );
    const courier = data.available_courier_companies[0] as Record<
      string,
      unknown
    >;
    const rate = Number(courier.rate);
    const courierCompanyId = courier.courier_company_id;
    const serviceCode =
      typeof courierCompanyId === "string" || typeof courierCompanyId === "number"
        ? String(courierCompanyId)
        : "";
    if (!Number.isFinite(rate) || rate < 0 || !serviceCode) {
      throw new ServiceUnavailableException("Shiprocket returned an invalid rate");
    }
    return {
      amountMinor: Math.round(rate * 100),
      currency: "INR",
      provider: "SHIPROCKET",
      serviceCode,
      estimatedDays: Number(courier.estimated_delivery_days) || undefined,
      development: false,
    };
  }
  createShipment(input: ShipmentCreateInput): Promise<ShipmentCreateResult> {
    return this.createProviderOrder(input, false);
  }
  createReturnShipment(
    input: ShipmentCreateInput,
  ): Promise<ShipmentCreateResult> {
    return this.createProviderOrder(input, true);
  }
  private async createProviderOrder(
    input: ShipmentCreateInput,
    isReturn: boolean,
  ): Promise<ShipmentCreateResult> {
    const endpoint = isReturn
      ? "https://apiv2.shiprocket.in/v1/external/orders/create/return"
      : "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc";
    const payload = {
      order_id: input.vendorOrderNumber,
      order_date: new Date().toISOString().slice(0, 10),
      pickup_location: input.originPincode,
      billing_customer_name: input.destination.name,
      billing_address: input.destination.line1,
      billing_address_2: input.destination.line2 ?? "",
      billing_city: input.destination.city,
      billing_pincode: input.destination.pincode,
      billing_state: input.destination.state,
      billing_country: "India",
      billing_phone: input.destination.mobile,
      shipping_is_billing: true,
      order_items: input.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        units: item.quantity,
        selling_price: item.unitPriceMinor / 100,
      })),
      payment_method: input.cod ? "COD" : "Prepaid",
      sub_total: input.amountMinor / 100,
      weight: input.weightGrams / 1000,
    };
    const { response, body } = await this.authorizedRequest(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    }, "Shiprocket shipment creation failed");
    if (
      !response.ok ||
      !body ||
      typeof body !== "object" ||
      !("shipment_id" in body)
    )
      throw new ServiceUnavailableException(
        "Shiprocket shipment creation failed",
      );
    const result = body as Record<string, unknown>;
    const awb =
      typeof result.awb_code === "string" || typeof result.awb_code === "number"
        ? String(result.awb_code)
        : undefined;
    return {
      provider: "SHIPROCKET",
      providerShipmentId: String(result.shipment_id),
      ...(awb ? { awb } : {}),
      development: false,
    };
  }
}
