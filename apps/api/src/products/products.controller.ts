import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import {
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from "./products.dto";
import { ProductsService } from "./products.service";

@ApiTags("Products")
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Get("products")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  @Header("CDN-Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400")
  @Header("Vercel-CDN-Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400")
  list(@Query() query: ProductQueryDto) {
    return this.products.publicList(query);
  }
  @Get("products/:id")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  @Header("CDN-Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400")
  @Header("Vercel-CDN-Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400")
  get(@Param("id") id: string) {
    return this.products.publicGet(id);
  }
  @Get("product-images/:filename")
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  @Header("CDN-Cache-Control", "public, s-maxage=31536000, immutable")
  @Header("Vercel-CDN-Cache-Control", "public, s-maxage=31536000, immutable")
  async image(@Param("filename") filename: string) {
    const image = await this.products.readImage(filename);
    return new StreamableFile(image.bytes, {
      type: image.mimeType,
      disposition: "inline",
    });
  }
  @Get("vendor/products")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  vendorList(
    @CurrentUser() user: RequestUser,
    @Query() query: ProductQueryDto,
  ) {
    return this.products.vendorList(user.id, query);
  }
  @Post("vendor/products")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  create(@CurrentUser() user: RequestUser, @Body() input: CreateProductDto) {
    return this.products.create(user.id, input);
  }
  @Post("vendor/products/:id/images")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @UseInterceptors(
    FilesInterceptor("images", 10, {
      limits: { fileSize: 5_242_880, files: 10, fields: 0 },
    }),
  )
  uploadImages(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.products.uploadImages(user.id, id, files);
  }
  @Get("vendor/products/:id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  owned(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.products.getOwned(user.id, id);
  }
  @Patch("vendor/products/:id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: UpdateProductDto,
  ) {
    return this.products.update(user.id, id, input);
  }
  @Post("vendor/products/:id/submit")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  submit(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.products.submit(user.id, id);
  }
  @Delete("vendor/products/:id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  archive(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.products.archive(user.id, id);
  }
}
