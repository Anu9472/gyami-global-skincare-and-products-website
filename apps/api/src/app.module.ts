import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { RedisModule, RedisToken } from "@nestjs-redis/client";
import {
  RedisThrottlerStorage,
  ThrottlerAlgorithm,
} from "@nestjs-redis/throttler-storage";
import { ConfigModule } from "@nestjs/config";
import type { RedisClientType } from "redis";
import { AddressesModule } from "./addresses/addresses.module";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { CartModule } from "./cart/cart.module";
import { CategoriesModule } from "./categories/categories.module";
import { CheckoutModule } from "./checkout/checkout.module";
import { CommissionModule } from "./commission/commission.module";
import { ComplaintsModule } from "./complaints/complaints.module";
import { validateEnvironment } from "./config/environment";
import { CustomersModule } from "./customers/customers.module";
import { DatabaseModule } from "./database/database.module";
import { InventoryModule } from "./inventory/inventory.module";
import { HomeHeroModule } from "./home-hero/home-hero.module";
import { IntegrationSettingsModule } from "./integration-settings/integration-settings.module";
import { LedgerModule } from "./ledger/ledger.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { ProductsModule } from "./products/products.module";
import { RefundsModule } from "./refunds/refunds.module";
import { ReplacementsModule } from "./replacements/replacements.module";
import { ReturnsModule } from "./returns/returns.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { SettlementsModule } from "./settlements/settlements.module";
import { ShipmentsModule } from "./shipments/shipments.module";
import { UsersModule } from "./users/users.module";
import { VendorDocumentsModule } from "./vendor-documents/vendor-documents.module";
import { VendorInspectionsModule } from "./vendor-inspections/vendor-inspections.module";
import { VendorsModule } from "./vendors/vendors.module";
import { HealthController } from "./health.controller";
import { PrivateObjectStorageModule } from "./storage/private-object-storage.module";
import { NoStoreResponseInterceptor } from "./common/no-store-response.interceptor";
import { ApplicationLifecycleService } from "./common/application-lifecycle.service";
import { MetricsModule } from "./metrics/metrics.module";

const throttlerModule = process.env.THROTTLE_REDIS_URL
  ? ThrottlerModule.forRootAsync({
      imports: [
        RedisModule.forRoot({
          options: { url: process.env.THROTTLE_REDIS_URL },
        }),
      ],
      inject: [RedisToken()],
      useFactory: (redis: RedisClientType) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new RedisThrottlerStorage(
          redis,
          ThrottlerAlgorithm.SlidingWindowCounter,
        ),
      }),
    })
  : ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    throttlerModule,
    DatabaseModule,
    PrivateObjectStorageModule,
    IntegrationSettingsModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    AddressesModule,
    VendorsModule,
    VendorDocumentsModule,
    VendorInspectionsModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    HomeHeroModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    ShipmentsModule,
    CommissionModule,
    AdminModule,
    LedgerModule,
    SettlementsModule,
    RefundsModule,
    ReturnsModule,
    ReplacementsModule,
    ReviewsModule,
    ComplaintsModule,
    NotificationsModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    NoStoreResponseInterceptor,
    ApplicationLifecycleService,
  ],
})
export class AppModule {}
