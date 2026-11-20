import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Plus, Send, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { api, money, type Product } from "../api/client";
import { AsyncState, Status } from "../components/AsyncState";
import { Field } from "./AuthPages";
import { PageHead } from "./DashboardPage";
interface Category {
  id: string;
  name: string;
}
interface ProductForm {
  categoryId: string;
  name: string;
  description: string;
  productType: string;
  price: number;
  mrp?: number;
  gstRate: number;
  weightGrams: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  qualityGrade: string;
  ingredients: string;
  stock: number;
}
export function ProductsPage() {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<Product | null | undefined>();
  const [status, setStatus] = useState("");
  const products = useQuery({
    queryKey: ["products", status],
    queryFn: () =>
      api.get<Product[]>(
        `/vendor/products?limit=100${status ? `&status=${status}` : ""}`,
      ),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories"),
  });
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "submit" | "delete" }) =>
      type === "submit"
        ? api.post(`/vendor/products/${id}/submit`)
        : api.delete(`/vendor/products/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["products"] }),
  });
  return (
    <>
      <PageHead
        eyebrow="Catalogue"
        title="Products"
        subtitle="Create drafts, resolve approval feedback and submit products for review."
        actions={
          <button className="primary" onClick={() => setEditor(null)}>
            <Plus />
            New product
          </button>
        }
      />
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {[
            "DRAFT",
            "PENDING_APPROVAL",
            "APPROVED",
            "REJECTED",
            "ARCHIVED",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <AsyncState
        loading={products.isLoading}
        error={products.error}
        empty={!products.data?.length}
        onRetry={() => void products.refetch()}
      >
        <div className="product-list">
          {products.data?.map((p) => (
            <article className="product-row" key={p.id}>
              {p.images[0]?.url ? (
                <img src={p.images[0].url} alt="" />
              ) : (
                <span className="product-row__image-placeholder" aria-label="Product photo required">Photo required</span>
              )}
              <div>
                <strong>{p.name}</strong>
                <span>
                  {p.category.name} · {p.productType.replaceAll("_", " ")}
                </span>
                {p.rejectionReason && (
                  <small className="form-error">{p.rejectionReason}</small>
                )}
              </div>
              <div>
                <strong>{money(p.price)}</strong>
                <Status value={p.status} />
              </div>
              <div className="row-actions">
                {(p.status === "DRAFT" || p.status === "REJECTED") && (
                  <>
                    <ProductPhotoUpload product={p} />
                    <button onClick={() => setEditor(p)}>
                      <Edit3 />
                      Edit
                    </button>
                    <button
                      onClick={() =>
                        action.mutate({ id: p.id, type: "submit" })
                      }
                    >
                      <Send />
                      Submit
                    </button>
                  </>
                )}
                <button
                  className="danger-link"
                  onClick={() => action.mutate({ id: p.id, type: "delete" })}
                >
                  <Trash2 />
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>
      </AsyncState>
      {editor !== undefined && (
        <ProductEditor
          product={editor}
          categories={categories.data ?? []}
          close={() => setEditor(undefined)}
        />
      )}
    </>
  );
}
function ProductPhotoUpload({ product }: { product: Product }) {
  const id = useId();
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const body = new FormData();
      Array.from(files).forEach((file) => body.append("images", file));
      return api.form<Product>(`/vendor/products/${product.id}/images`, body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["products"] }),
  });
  return (
    <label className={`secondary product-photo-button ${upload.isPending ? "is-disabled" : ""}`} htmlFor={id}>
      {upload.isPending ? "Optimizing…" : product.images.length ? "Replace photos" : "Add photos"}
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={upload.isPending}
        onChange={(event) => {
          if (event.target.files?.length) upload.mutate(event.target.files);
          event.target.value = "";
        }}
      />
      {upload.isError && <span className="form-error">{upload.error.message}</span>}
    </label>
  );
}
function ProductEditor({
  product,
  categories,
  close,
}: {
  product: Product | null;
  categories: Category[];
  close: () => void;
}) {
  const qc = useQueryClient();
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const form = useForm<ProductForm>({
    defaultValues: product
      ? {
          categoryId: product.category.id,
          name: product.name,
          description: product.description,
          productType: product.productType,
          price: Number(product.price),
          mrp: Number(product.mrp ?? 0) || undefined,
          gstRate: Number(product.gstRate),
          weightGrams: product.weightGrams,
          lengthCm: Number(product.lengthCm ?? 0) || undefined,
          widthCm: Number(product.widthCm ?? 0) || undefined,
          heightCm: Number(product.heightCm ?? 0) || undefined,
          qualityGrade: product.specifications?.qualityGrade ?? "",
          ingredients: product.ingredients ?? "",
          stock: product.inventory?.quantity ?? 0,
        }
      : { productType: "RAW_COMMODITY", gstRate: 0, stock: 0, qualityGrade: "" },
  });
  const save = useMutation({
    mutationFn: async (v: ProductForm) => {
      const { qualityGrade, stock, ...values } = v;
      const payload = {
        ...values,
        price: Number(v.price),
        mrp: v.mrp ? Number(v.mrp) : undefined,
        gstRate: Number(v.gstRate),
        weightGrams: Number(v.weightGrams),
        lengthCm: v.lengthCm ? Number(v.lengthCm) : undefined,
        widthCm: v.widthCm ? Number(v.widthCm) : undefined,
        heightCm: v.heightCm ? Number(v.heightCm) : undefined,
        specifications: qualityGrade ? { qualityGrade } : {},
        ...(!product ? { stock: Number(stock) } : {}),
      };
      const saved = await (product
        ? api.patch(`/vendor/products/${product.id}`, payload)
        : api.post<Product>("/vendor/products", payload));
      const savedProduct = saved as Product;
      if (photoFiles.length) {
        const body = new FormData();
        photoFiles.forEach((file) => body.append("images", file));
        return api.form<Product>(`/vendor/products/${savedProduct.id}/images`, body);
      }
      return savedProduct;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      close();
    },
  });
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <button className="modal-close" onClick={close}>
          <X />
        </button>
        <small>PRODUCT WORKFLOW</small>
        <h2>{product ? "Edit draft product" : "Create a product"}</h2>
        <form
          className="form-grid"
          onSubmit={(event) => void form.handleSubmit((v) => save.mutate(v))(event)}
        >
          <Field label="Category">
            <select {...form.register("categoryId", { required: true })}>
              <option value="">Select category</option>
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product type">
            <select {...form.register("productType")}>
              <option value="RAW_COMMODITY">Raw commodity</option>
              <option value="VALUE_ADDED">Value added</option>
            </select>
          </Field>
          <Field label="Product name">
            <input {...form.register("name", { required: true })} />
          </Field>
          <Field label="Weight (grams)">
            <input
              type="number"
              {...form.register("weightGrams", {
                valueAsNumber: true,
                required: true,
              })}
            />
          </Field>
          <Field label="Quality / grade">
            <input placeholder="For example: Premium, A grade" {...form.register("qualityGrade", { required: true })} />
          </Field>
          <Field label="Package length (cm)">
            <input type="number" step=".1" {...form.register("lengthCm", { valueAsNumber: true })} />
          </Field>
          <Field label="Package width (cm)">
            <input type="number" step=".1" {...form.register("widthCm", { valueAsNumber: true })} />
          </Field>
          <Field label="Package height (cm)">
            <input type="number" step=".1" {...form.register("heightCm", { valueAsNumber: true })} />
          </Field>
          <Field label="Selling price (GST inclusive)">
            <input
              type="number"
              step=".01"
              {...form.register("price", {
                valueAsNumber: true,
                required: true,
              })}
            />
          </Field>
          <Field label="MRP">
            <input
              type="number"
              step=".01"
              {...form.register("mrp", { valueAsNumber: true })}
            />
          </Field>
          <Field label="GST rate for records">
            <input
              type="number"
              step=".01"
              {...form.register("gstRate", {
                valueAsNumber: true,
                required: true,
              })}
            />
          </Field>
          {!product && (
            <Field label="Initial stock">
              <input
                type="number"
                {...form.register("stock", { valueAsNumber: true })}
              />
            </Field>
          )}
          <Field label="Description">
            <textarea {...form.register("description", { required: true })} />
          </Field>
          <Field label="Ingredients">
            <textarea {...form.register("ingredients")} />
          </Field>
          <Field label="Product photos">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => setPhotoFiles(Array.from(event.target.files ?? []))}
            />
            <small>{photoFiles.length ? `${photoFiles.length} photo${photoFiles.length === 1 ? "" : "s"} selected. Photos are cropped and optimized automatically.` : "Choose up to 10 JPG, PNG or WebP photos. Each may be up to 5 MB and is standardized to a square 900 × 900 image."}</small>
          </Field>
          {save.error && <p className="form-error">{save.error.message}</p>}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={save.isPending}>
              Save draft
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
