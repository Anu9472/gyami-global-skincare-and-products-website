import { Module } from "@nestjs/common";
import { VendorDocumentsModule } from "../vendor-documents/vendor-documents.module";
import { VendorInspectionsModule } from "../vendor-inspections/vendor-inspections.module";
import { VendorsModule } from "../vendors/vendors.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PaymentsModule } from "../payments/payments.module";
import { ShipmentsModule } from "../shipments/shipments.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
@Module({
  imports: [
    VendorsModule,
    VendorDocumentsModule,
    VendorInspectionsModule,
    NotificationsModule,
    PaymentsModule,
    ShipmentsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
