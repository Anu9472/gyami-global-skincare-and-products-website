import { Module } from "@nestjs/common";
import { VendorsModule } from "../vendors/vendors.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { ProductImageStorageService } from "./product-image-storage.service";
@Module({
  imports: [VendorsModule, NotificationsModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductImageStorageService],
  exports: [ProductsService],
})
export class ProductsModule {}
