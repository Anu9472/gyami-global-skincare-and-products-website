import { IsOptional, IsUUID } from "class-validator";
import { PaginationDto } from "./pagination.dto";

/** Shared query validation for administrator screens scoped to one vendor. */
export class VendorFilterDto {
  @IsOptional() @IsUUID() vendorId?: string;
}

export class VendorPaginationDto extends PaginationDto {
  @IsOptional() @IsUUID() vendorId?: string;
}
