import { useEffect, useRef, useState } from "react";
import {
  createProduct, deleteProductImage, deleteProductVariant, getProductById, reorderProductImages,
  setMainProductVariant, setPrimaryProductImage, setProductActive, setProductVariantActive,
  updateProduct, updateProductImage, uploadProductImage,
} from "../../services/api";
import useConfirmAction from "../../hooks/useConfirmAction";
import { announceCatalogueChanged } from "../../services/catalogueEvents";

/**
 * The guided Add/Edit Product workflow, built around the product family:
 *
 *   1. Main product — the shared family information plus Variant 1, which IS the main product.
 *   2. Does this product have more variants? — nothing variant-shaped is shown unless the admin
 *      says yes, so a single-colour product never scrolls past empty variant forms.
 *   3. Review and save — a summary, then Save as draft or Publish.
 *
 * Creation is draft-first on the wire even when the admin clicks Publish: the family is created
 * inactive, every photo is uploaded, and only a fully-uploaded product is activated. A photo
 * failure therefore leaves a draft and an honest message, never a half-illustrated live product.
 *
 * Server validation errors arrive keyed by field path (variants[1].sku); each is rendered against
 * its own input, and the wizard jumps to the step holding the first one.
 */

/** Documented safe ceiling — the backend has no hard variant limit, so the form provides one. */
const MAX_VARIANTS = 10;
/** Mirrors app.catalog.max-variant-images on the server: 1 main photo + 9 additional. */
const MAX_IMAGES_PER_VARIANT = 10;

// Not crypto.randomUUID(): jsdom (the unit-test DOM) has no crypto global, and a form key only
// has to be unique within one mounted wizard.
let clientIdCounter = 0;
const nextClientId = () => `draft-${(clientIdCounter += 1)}`;

const blankVariant = () => ({
  clientId: nextClientId(), variantId: null, sku: "", variantName: "", color: "", lensColor: "",
  variantDescription: "", price: "", quantityAvailable: "0", lowStockThreshold: "5", isActive: true,
  mainFile: null, extraFiles: [], imageAlt: "",
});

const blankShared = () => ({
  productName: "", brand: "Shades World", productDescription: "", categoryIds: [],
  attributes: { frame_material: "", frame_shape: "", uv_protection: "UV400", polarization: "" },
});

const variantFromResponse = (variant) => ({
  clientId: String(variant.variantId), variantId: variant.variantId, sku: variant.sku,
  variantName: variant.variantName || "", color: variant.attributes?.color || "",
  lensColor: variant.attributes?.lens_color || "", variantDescription: variant.variantDescription || "",
  price: String(variant.price), quantityAvailable: String(variant.quantityAvailable),
  lowStockThreshold: String(variant.lowStockThreshold), isActive: variant.isActive !== false,
  mainFile: null, extraFiles: [], imageAlt: "",
});

/** jsdom has no URL.createObjectURL; the preview then falls back to the file name. */
const previewUrl = (file) => (typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
  ? URL.createObjectURL(file) : null);

const variantTitle = (variant, index) =>
  index === 0 ? "Main product — Variant 1" : `Variant ${index + 1}`;

const variantDisplayName = (variant) => variant.color || variant.variantName || variant.sku || "this variant";

export default function ProductWizard({ product, categories, accessToken, onClose, onSaved }) {
  const editing = Boolean(product);
  const confirmAction = useConfirmAction();
  const [step, setStep] = useState(1);
  // Edit mode keeps a live copy of the server's product so image operations (which apply
  // immediately) and field edits (which apply on Save) cannot clobber each other.
  const [live, setLive] = useState(product || null);
  const [shared, setShared] = useState(() => (product ? {
    productName: product.productName, brand: product.brand || "",
    productDescription: product.productDescription || "",
    categoryIds: product.categories?.map((category) => category.categoryId) || [],
    attributes: { ...blankShared().attributes, ...(product.attributes || {}) },
  } : blankShared()));
  const [variants, setVariants] = useState(() => (product
    ? [...(product.variants || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(variantFromResponse)
    : [blankVariant()]));
  const [hasMore, setHasMore] = useState(product && (product.variants || []).length > 1 ? "yes" : "no");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dirty, setDirty] = useState(false);
  const focusPathRef = useRef(null);

  // Focus and scroll to the first invalid field once errors land — after render, so the element
  // exists. Field inputs carry id={`pw-${path}`}.
  useEffect(() => {
    if (!focusPathRef.current) return;
    const element = document.getElementById(`pw-${focusPathRef.current}`);
    focusPathRef.current = null;
    if (element) {
      element.focus();
      if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center" });
    }
  }, [errors]);

  const markDirty = () => setDirty(true);
  const updateShared = (field, value) => { markDirty(); setShared((current) => ({ ...current, [field]: value })); };
  const updateAttribute = (field, value) => { markDirty(); setShared((current) => ({ ...current, attributes: { ...current.attributes, [field]: value } })); };
  const updateVariant = (clientId, field, value) => { markDirty(); setVariants((current) => current.map((variant) => (variant.clientId === clientId ? { ...variant, [field]: value } : variant))); };

  const addVariant = () => {
    if (variants.length >= MAX_VARIANTS) { setFormError(`A product can have at most ${MAX_VARIANTS} variants.`); return; }
    markDirty();
    setVariants((current) => [...current, blankVariant()]);
  };

  const removeUnsavedVariant = (clientId) => { markDirty(); setVariants((current) => current.filter((variant) => variant.clientId !== clientId)); };

  // ── Validation ────────────────────────────────────────────────────────────────────────────

  const stepForPath = (path) => {
    const match = /^variants\[(\d+)\]/.exec(path);
    if (match) return Number(match[1]) === 0 ? 1 : 2;
    return 1;
  };

  const applyErrors = (map) => {
    setErrors(map);
    const first = Object.keys(map)[0];
    if (first) {
      setStep(stepForPath(first));
      focusPathRef.current = first;
    }
  };

  const clientErrorsFor = (indices) => {
    const found = {};
    if (indices.includes(0)) {
      if (!shared.productName.trim()) found.productName = "Give the product a name.";
      if (shared.categoryIds.length !== 1) found.categoryIds = "Select one category: Men, Women, Unisex, or Accessory.";
    }
    indices.forEach((index) => {
      const variant = variants[index];
      if (!variant) return;
      if (!variant.color.trim() && !variant.variantName.trim()) found[`variants[${index}].color`] = "Name the colour (or give the variant a name).";
      if (!variant.sku.trim()) found[`variants[${index}].sku`] = "A unique SKU is required.";
      const duplicate = variants.findIndex((other, otherIndex) => otherIndex < index && other.sku.trim() && other.sku.trim() === variant.sku.trim());
      if (variant.sku.trim() && duplicate >= 0) found[`variants[${index}].sku`] = `Variant ${duplicate + 1} already uses this SKU.`;
      if (variant.price === "" || Number(variant.price) < 0 || Number.isNaN(Number(variant.price))) found[`variants[${index}].price`] = "Enter a price of 0 or more.";
      if (variant.quantityAvailable === "" || Number(variant.quantityAvailable) < 0) found[`variants[${index}].quantityAvailable`] = "Enter stock of 0 or more.";
      if (variant.extraFiles.length + (variant.mainFile ? 1 : 0) > MAX_IMAGES_PER_VARIANT) {
        found[`variants[${index}].images`] = `At most ${MAX_IMAGES_PER_VARIANT} photos per variant (1 main + ${MAX_IMAGES_PER_VARIANT - 1} additional).`;
      }
    });
    return found;
  };

  const advanceFrom = (currentStep) => {
    const indices = currentStep === 1 ? [0] : variants.map((_, index) => index).filter((index) => index > 0);
    const found = clientErrorsFor(indices);
    if (Object.keys(found).length) { applyErrors(found); return; }
    setErrors({});
    setStep(currentStep + 1);
  };

  // ── Saving ────────────────────────────────────────────────────────────────────────────────

  const variantPayload = (variant) => ({
    variantId: variant.variantId || undefined,
    sku: variant.sku.trim(),
    variantName: variant.variantName || variant.color || "Default",
    variantDescription: variant.variantDescription || null,
    price: Number(variant.price),
    quantityAvailable: Number(variant.quantityAvailable),
    lowStockThreshold: Number(variant.lowStockThreshold || 0),
    isActive: variant.isActive,
    attributes: { color: variant.color, lens_color: variant.lensColor },
  });

  const sharedPayload = () => ({
    productName: shared.productName.trim(),
    brand: shared.brand,
    productDescription: shared.productDescription,
    categoryIds: shared.categoryIds,
    attributes: Object.fromEntries(Object.entries(shared.attributes).filter(([, value]) => value)),
  });

  /**
   * Uploads one variant's staged photos: the main photo first (isPrimary), then the additional
   * ones, sequentially so DISPLAY_ORDER lands in the order the admin picked them. Failures are
   * collected, not thrown — four good photos must not be reported as one bad batch.
   */
  const uploadVariantPhotos = async (productId, savedVariantId, variant, existingCount, failures) => {
    const files = [...(variant.mainFile ? [{ file: variant.mainFile, main: true }] : []),
      ...variant.extraFiles.map((file) => ({ file, main: false }))];
    let order = existingCount;
    for (const { file, main } of files) {
      setUploadProgress({ name: file.name, variant: variantDisplayName(variant) });
      try {
        await uploadProductImage(accessToken, productId, file, {
          altText: variant.imageAlt || `${shared.productName} ${variantDisplayName(variant)}`,
          variantId: savedVariantId, displayOrder: order, isPrimary: main,
        });
        order += 1;
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError.message}`);
      }
    }
    setUploadProgress(null);
  };

  const uploadAllPhotos = async (saved) => {
    const failures = [];
    // createProduct/updateProduct answer with variants in family order — the same order this
    // wizard sent them — so index n of the response is index n of the form.
    const savedByIndex = [...(saved.variants || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const savedVariant = variant.variantId
        ? savedByIndex.find((candidate) => candidate.variantId === variant.variantId)
        : savedByIndex[index];
      if (!savedVariant) continue;
      const existingCount = (saved.images || []).filter((image) => image.variantId === savedVariant.variantId).length;
      await uploadVariantPhotos(saved.productId, savedVariant.variantId, variant, existingCount, failures);
    }
    return failures;
  };

  const applyServerErrors = (error) => {
    if (error.validationErrors && Object.keys(error.validationErrors).length) {
      applyErrors(error.validationErrors);
      setFormError("Some fields need attention — they are marked below.");
    } else {
      setFormError(error.message);
    }
  };

  /**
   * Tells every storefront surface — this tab and any other open tab of the shop — that the
   * catalogue changed, so their cached product lists refetch. Without it, a home page opened
   * before this save kept showing the old list: the new product missing, and cards for products
   * that no longer exist 404ing as "Product not found" on click.
   */
  const announceCatalogueChange = () => announceCatalogueChanged();

  const save = async (publish) => {
    if (saving) return;
    const found = clientErrorsFor(variants.map((_, index) => index));
    if (Object.keys(found).length) { applyErrors(found); return; }
    setSaving(true); setFormError(""); setErrors({});
    try {
      if (editing) {
        const payload = { ...sharedPayload(), version: live?.version, variants: variants.map(variantPayload) };
        const saved = await updateProduct(accessToken, product.productId, payload);
        const failures = await uploadAllPhotos(saved);
        announceCatalogueChange();
        onSaved(failures.length
          ? `${saved.productName} was saved, but ${failures.length} photo(s) failed — ${failures.join("; ")}`
          : `${saved.productName} was updated.`);
      } else {
        // Draft first, publish last: nothing goes live until every photo is accounted for.
        const payload = { ...sharedPayload(), isActive: false, variants: variants.map(variantPayload) };
        const saved = await createProduct(accessToken, payload);
        const failures = await uploadAllPhotos(saved);
        if (publish && failures.length === 0) {
          await setProductActive(accessToken, saved.productId, true);
          announceCatalogueChange();
          onSaved(`${saved.productName} is published.`);
        } else if (failures.length) {
          onSaved(`${saved.productName} was saved as a draft — ${failures.length} photo(s) failed to upload `
            + `(${failures.join("; ")}). Open Edit to retry them, then publish.`);
        } else {
          onSaved(`${saved.productName} was saved as a draft.`);
        }
      }
    } catch (error) {
      applyServerErrors(error);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (!dirty) { onClose(); return; }
    confirmAction.ask({
      title: "Discard unsaved changes?",
      body: <p>This product has unsaved changes. Closing now will lose them.</p>,
      confirmLabel: "Discard changes",
      busyLabel: "Closing…",
      run: () => onClose(),
    });
  };

  // ── Edit-mode image management (applies immediately, like the old image editor) ───────────

  const refreshLive = async () => {
    try {
      const fresh = await getProductById(product.productId);
      setLive(fresh);
      return fresh;
    } catch (error) { setFormError(error.message); return null; }
  };

  const liveImagesFor = (variant) => {
    if (!editing || !variant.variantId || !live) return [];
    const mainVariantId = [...(live.variants || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.variantId;
    return (live.images || []).filter((image) => (image.variantId == null
      ? variant.variantId === mainVariantId
      : image.variantId === variant.variantId));
  };

  const applyImages = (images) => setLive((current) => (current ? { ...current, images } : current));

  const moveImage = async (image, delta, scopeImages) => {
    const ordered = [...(live.images || [])];
    const scopeFrom = scopeImages.findIndex((candidate) => candidate.imageId === image.imageId);
    const neighbour = scopeImages[scopeFrom + delta];
    if (scopeFrom < 0 || !neighbour) return;
    const from = ordered.findIndex((candidate) => candidate.imageId === image.imageId);
    const to = ordered.findIndex((candidate) => candidate.imageId === neighbour.imageId);
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    applyImages(ordered);
    try {
      const saved = await reorderProductImages(accessToken, product.productId, ordered.map((candidate) => candidate.imageId));
      applyImages(saved);
    } catch (error) { setFormError(error.message); await refreshLive(); }
  };

  const makeMainImage = async (image) => {
    try {
      const saved = await setPrimaryProductImage(accessToken, product.productId, image.imageId);
      applyImages(saved);
    } catch (error) { setFormError(error.message); }
  };

  const saveAltText = async (image, altText) => {
    if ((image.altText || "") === altText) return;
    try {
      const saved = await updateProductImage(accessToken, product.productId, image.imageId, { altText });
      applyImages((live.images || []).map((candidate) => (candidate.imageId === saved.imageId ? saved : candidate)));
    } catch (error) { setFormError(error.message); }
  };

  const removeImage = (image) => confirmAction.ask({
    title: "Remove this photo?",
    body: <p>The photo will be removed from the product permanently.</p>,
    confirmLabel: "Remove photo",
    busyLabel: "Removing…",
    run: async () => { await deleteProductImage(accessToken, product.productId, image.imageId); await refreshLive(); },
  });

  const refileImage = async (image, value) => {
    try {
      await updateProductImage(accessToken, product.productId, image.imageId, { variantId: value ? Number(value) : 0 });
      await refreshLive();
    } catch (error) { setFormError(error.message); }
  };

  // ── Edit-mode variant management ──────────────────────────────────────────────────────────

  const archiveVariant = (variant, active) => confirmAction.ask({
    title: active ? "Restore this variant?" : "Archive this variant?",
    body: <p><strong>{variantDisplayName(variant)}</strong> {active
      ? "will be offered for sale again."
      : "stops being sold, but keeps its photos, stock and order history. You can restore it later."}</p>,
    confirmLabel: active ? "Restore" : "Archive",
    busyLabel: "Saving…",
    run: async () => {
      await setProductVariantActive(accessToken, product.productId, variant.variantId, active);
      setVariants((current) => current.map((candidate) => (candidate.clientId === variant.clientId
        ? { ...candidate, isActive: active } : candidate)));
      await refreshLive();
    },
  });

  const deleteSavedVariant = (variant) => confirmAction.ask({
    title: "Delete this variant?",
    body: <p><strong>{variantDisplayName(variant)}</strong> will be deleted. Its photos move to the main
      product. A variant that has ever been ordered cannot be deleted — archive it instead.</p>,
    confirmLabel: "Delete variant",
    busyLabel: "Deleting…",
    run: async () => {
      await deleteProductVariant(accessToken, product.productId, variant.variantId);
      setVariants((current) => current.filter((candidate) => candidate.clientId !== variant.clientId));
      await refreshLive();
    },
  });

  const makeMainVariant = (variant) => confirmAction.ask({
    title: "Make this the main product?",
    body: <p><strong>{variantDisplayName(variant)}</strong> becomes Variant 1: it fronts listings and is
      selected first on the product page. The current main product becomes an ordinary variant.</p>,
    confirmLabel: "Set as main product",
    busyLabel: "Saving…",
    run: async () => {
      const saved = await setMainProductVariant(accessToken, product.productId, variant.variantId);
      setLive(saved);
      // Reorder the form to the new family order without losing unsaved field edits.
      const orderOf = new Map((saved.variants || []).map((candidate) => [candidate.variantId, candidate.position]));
      setVariants((current) => [...current].sort((a, b) =>
        (orderOf.get(a.variantId) ?? MAX_VARIANTS + 1) - (orderOf.get(b.variantId) ?? MAX_VARIANTS + 1)));
    },
  });

  // ── Rendering ────────────────────────────────────────────────────────────────────────────

  const fieldError = (path) => errors[path] && <small className="pw-field-error" role="alert">{errors[path]}</small>;
  /** id + invalid styling in one place, so every marked field looks and reads the same. */
  const fieldProps = (path) => ({
    id: `pw-${path}`,
    "aria-invalid": errors[path] ? true : undefined,
    className: errors[path] ? "pw-invalid" : undefined,
  });

  const filePreview = (file) => {
    const url = previewUrl(file);
    return url
      ? <img src={url} alt={file.name} onLoad={(event) => URL.revokeObjectURL(event.target.src)} />
      : <span className="pw-file-name">{file.name}</span>;
  };

  const variantFields = (variant, index) => <div className="variant-fields">
    <label>Color *<input {...fieldProps(`variants[${index}].color`)} value={variant.color}
      onChange={(event) => updateVariant(variant.clientId, "color", event.target.value)} placeholder="Blue" />
      {fieldError(`variants[${index}].color`)}</label>
    <label>Lens color<input value={variant.lensColor}
      onChange={(event) => updateVariant(variant.clientId, "lensColor", event.target.value)} placeholder="Smoke blue" /></label>
    <label>SKU *<input {...fieldProps(`variants[${index}].sku`)} value={variant.sku}
      onChange={(event) => updateVariant(variant.clientId, "sku", event.target.value)} />
      {fieldError(`variants[${index}].sku`)}</label>
    <label>Variant name<input value={variant.variantName}
      onChange={(event) => updateVariant(variant.clientId, "variantName", event.target.value)} placeholder="Ocean Blue" /></label>
    <label>Price (₹) *<input {...fieldProps(`variants[${index}].price`)} type="number" min="0" step=".01" value={variant.price}
      onChange={(event) => updateVariant(variant.clientId, "price", event.target.value)} />
      {fieldError(`variants[${index}].price`)}</label>
    <label>Stock *<input {...fieldProps(`variants[${index}].quantityAvailable`)} type="number" min="0" value={variant.quantityAvailable}
      onChange={(event) => updateVariant(variant.clientId, "quantityAvailable", event.target.value)} />
      {fieldError(`variants[${index}].quantityAvailable`)}</label>
    <label>Low-stock alert<input type="number" min="0" value={variant.lowStockThreshold}
      onChange={(event) => updateVariant(variant.clientId, "lowStockThreshold", event.target.value)} /></label>
    <label className="wide">Description for this variant (optional)<textarea rows="2" value={variant.variantDescription}
      onChange={(event) => updateVariant(variant.clientId, "variantDescription", event.target.value)}
      placeholder="Leave empty to use the shared product description" /></label>
  </div>;

  const variantPhotoSection = (variant, index) => {
    const existing = liveImagesFor(variant);
    const stagedCount = (variant.mainFile ? 1 : 0) + variant.extraFiles.length;
    const room = MAX_IMAGES_PER_VARIANT - existing.length - stagedCount;
    return <fieldset className="pw-photos">
      <legend>Photos for {variantDisplayName(variant)}</legend>
      {editing && variant.variantId && existing.length > 0 && <ol className="admin-image-editor">
        {existing.map((image, imageIndex) => <li key={image.imageId} className={image.isPrimary ? "is-primary" : ""}>
          <img src={image.imageUrl} alt={image.altText || "Product"} loading="lazy" />
          <div className="admin-image-meta">
            <span className="admin-image-position">{imageIndex + 1}{image.isPrimary && <em>Main image</em>}</span>
            <select className="admin-image-scope" aria-label={`Shown for image ${image.imageId}`}
              value={image.variantId ? String(image.variantId) : ""}
              onChange={(event) => refileImage(image, event.target.value)}>
              {variants.filter((candidate) => candidate.variantId).map((candidate) => (
                <option key={candidate.variantId} value={candidate.variantId}>For {variantDisplayName(candidate)}</option>))}
            </select>
            <input aria-label={`Alt text for image ${image.imageId}`} placeholder="Describe this photo"
              defaultValue={image.altText ?? ""} onBlur={(event) => saveAltText(image, event.target.value)} />
            <div className="admin-image-actions">
              <button type="button" onClick={() => moveImage(image, -1, existing)} disabled={imageIndex === 0}
                aria-label={`Move image ${image.imageId} earlier`}>↑</button>
              <button type="button" onClick={() => moveImage(image, 1, existing)} disabled={imageIndex === existing.length - 1}
                aria-label={`Move image ${image.imageId} later`}>↓</button>
              <button type="button" onClick={() => makeMainImage(image)} disabled={image.isPrimary}>
                {image.isPrimary ? "Main image" : "Make main image"}</button>
              <button type="button" className="danger" onClick={() => removeImage(image)}>Remove</button>
            </div>
          </div>
        </li>)}
      </ol>}
      <div className="photo-inputs">
        <label className="pw-file-label">{existing.some((image) => image.isPrimary) || variant.mainFile
          ? "Replace main photo" : "Main photo"}
          <input type="file" accept="image/jpeg,image/png,image/gif"
            aria-label={`Main photo for ${variantDisplayName(variant)}`}
            onChange={(event) => updateVariant(variant.clientId, "mainFile", event.target.files[0] || null)} />
        </label>
        <label className="pw-file-label">Additional photos
          <input type="file" accept="image/jpeg,image/png,image/gif" multiple
            aria-label={`Additional photos for ${variantDisplayName(variant)}`}
            onChange={(event) => updateVariant(variant.clientId, "extraFiles", [...event.target.files])} />
        </label>
        <input placeholder="Photo description / alt text" value={variant.imageAlt}
          aria-label={`Photo description for ${variantDisplayName(variant)}`}
          onChange={(event) => updateVariant(variant.clientId, "imageAlt", event.target.value)} />
      </div>
      {(variant.mainFile || variant.extraFiles.length > 0) && <ul className="pw-staged">
        {variant.mainFile && <li className="pw-staged-main">{filePreview(variant.mainFile)}<span>Main photo</span>
          <button type="button" onClick={() => updateVariant(variant.clientId, "mainFile", null)}>Remove</button></li>}
        {variant.extraFiles.map((file, fileIndex) => <li key={`${file.name}-${fileIndex}`}>{filePreview(file)}
          <span>Photo {fileIndex + 1}</span>
          <button type="button" onClick={() => updateVariant(variant.clientId, "extraFiles",
            variant.extraFiles.filter((_, candidateIndex) => candidateIndex !== fileIndex))}>Remove</button></li>)}
      </ul>}
      <small>{room >= 0 ? `${room} more photo(s) allowed for this variant · JPEG, PNG or GIF, 5 MB each`
        : `Too many photos selected — the limit is ${MAX_IMAGES_PER_VARIANT} per variant.`}</small>
      {fieldError(`variants[${index}].images`)}
    </fieldset>;
  };

  const variantSection = (variant, index) => <section className="draft-variant pw-variant" key={variant.clientId}
    data-variant-section={index + 1}>
    <div className="draft-variant-head">
      <strong>{variantTitle(variant, index)}{!variant.isActive && <em className="pw-archived-badge">Archived</em>}</strong>
      <div className="pw-variant-actions">
        {editing && index > 0 && variant.variantId && <button type="button" onClick={() => makeMainVariant(variant)}>Set as main</button>}
        {editing && index > 0 && variant.variantId && <button type="button" onClick={() => archiveVariant(variant, !variant.isActive)}>
          {variant.isActive ? "Archive" : "Restore"}</button>}
        {index > 0 && variant.variantId && <button type="button" className="danger" onClick={() => deleteSavedVariant(variant)}>Delete</button>}
        {index > 0 && !variant.variantId && <button type="button" onClick={() => removeUnsavedVariant(variant.clientId)}>Remove</button>}
      </div>
    </div>
    {variantFields(variant, index)}
    {variantPhotoSection(variant, index)}
  </section>;

  const summaryRows = variants.map((variant, index) => {
    const existing = liveImagesFor(variant);
    const existingMain = existing.find((image) => image.isPrimary) || existing[0];
    const stagedThumb = variant.mainFile ? previewUrl(variant.mainFile) : null;
    return { variant, index,
      thumb: stagedThumb || existingMain?.imageUrl || null,
      mainImage: variant.mainFile ? variant.mainFile.name
        : existingMain ? (existingMain.altText || existingMain.imageUrl.split("/").pop()) : "",
      photoCount: existing.length + (variant.mainFile ? 1 : 0) + variant.extraFiles.length };
  });

  const steps = [
    { number: 1, label: "Main product" },
    { number: 2, label: "More variants?" },
    { number: 3, label: "Review & save" },
  ];

  return <div className="admin-modal-backdrop" onMouseDown={requestClose}>
    {confirmAction.dialog}
    <form className="admin-product-modal product-create-modal pw" onMouseDown={(event) => event.stopPropagation()}
      onSubmit={(event) => event.preventDefault()} aria-label={editing ? "Edit product" : "Add product"}>
      <div className="modal-heading">
        <div>
          <span>{editing ? "Update catalog item" : "New catalog item"}</span>
          <h2>{editing ? `Edit ${product.productName}` : "Add product"}</h2>
        </div>
        <button type="button" onClick={requestClose} aria-label="Close">×</button>
      </div>

      <ol className="pw-steps">
        {steps.map((candidate) => <li key={candidate.number}
          className={candidate.number === step ? "current" : candidate.number < step ? "done" : ""}>
          <button type="button" disabled={candidate.number > step} onClick={() => setStep(candidate.number)}>
            <span className="pw-step-number" aria-hidden="true">{candidate.number < step ? "✓" : candidate.number}</span>
            <span className="pw-step-label">{candidate.label}</span>
          </button>
        </li>)}
      </ol>

      {formError && <div className="admin-alert error" role="alert">{formError}</div>}

      {step === 1 && <div className="pw-step" data-step="1">
        <h3>1. Main product</h3>
        <p className="pw-hint">The main product is Variant 1. It represents this product in storefront
          listings and is shown first when customers open the product page.</p>
        <div className="product-form-grid">
          <label>Product name *<input {...fieldProps("productName")} value={shared.productName}
            onChange={(event) => updateShared("productName", event.target.value)} />
            {fieldError("productName")}</label>
          <label>Brand<input value={shared.brand} onChange={(event) => updateShared("brand", event.target.value)} /></label>
          <label>Frame material<input value={shared.attributes.frame_material}
            onChange={(event) => updateAttribute("frame_material", event.target.value)} /></label>
          <label>Frame shape<input value={shared.attributes.frame_shape}
            onChange={(event) => updateAttribute("frame_shape", event.target.value)} /></label>
          <label>UV protection<input value={shared.attributes.uv_protection}
            onChange={(event) => updateAttribute("uv_protection", event.target.value)} /></label>
          <label className="wide">Shared description<textarea rows="3" value={shared.productDescription}
            onChange={(event) => updateShared("productDescription", event.target.value)}
            placeholder="Shown for every variant that has no description of its own" /></label>
          <fieldset className="wide"><legend>Category *</legend>
            <div className="category-checks" id="pw-categoryIds">
              {categories.map((category) => <label key={category.categoryId}>
                <input type="checkbox" checked={shared.categoryIds.includes(category.categoryId)}
                  onChange={() => updateShared("categoryIds", [category.categoryId])} />{category.categoryName}</label>)}
            </div>
            {fieldError("categoryIds")}
          </fieldset>
        </div>
        {variantSection(variants[0], 0)}
        <div className="modal-actions">
          <button type="button" onClick={requestClose}>Cancel</button>
          <button type="button" onClick={() => advanceFrom(1)}>Continue</button>
        </div>
      </div>}

      {step === 2 && <div className="pw-step" data-step="2">
        <h3>2. Does this product have more variants?</h3>
        <div className="pw-more-choice" role="radiogroup" aria-label="Does this product have more variants?">
          <label><input type="radio" name="pw-more" checked={hasMore === "no"}
            onChange={() => { setHasMore("no"); }} disabled={variants.length > 1} />
            No, this product has only the main variant</label>
          <label><input type="radio" name="pw-more" checked={hasMore === "yes"}
            onChange={() => setHasMore("yes")} />
            Yes, add more variants</label>
        </div>
        {hasMore === "yes" && <>
          {variants.slice(1).map((variant, offset) => variantSection(variant, offset + 1))}
          <button type="button" className="add-variant-button" onClick={addVariant}>+ Add variant</button>
        </>}
        <div className="modal-actions">
          <button type="button" onClick={() => setStep(1)}>Back</button>
          <button type="button" onClick={() => advanceFrom(2)}>Continue</button>
        </div>
      </div>}

      {step === 3 && <div className="pw-step" data-step="3">
        <h3>3. Review and save</h3>
        <dl className="pw-review">
          <div><dt>Product</dt><dd>{shared.productName || "—"}</dd></div>
          <div><dt>Main product</dt><dd>{variantDisplayName(variants[0])} · SKU {variants[0].sku || "—"}
            · ₹{variants[0].price || "—"} · {variants[0].quantityAvailable} in stock</dd></div>
          <div><dt>Additional variants</dt><dd>{variants.length - 1}</dd></div>
          <div><dt>Publication</dt><dd>{editing
            ? (live?.isActive ? "Published" : "Draft — publish from the product list")
            : "Choose below: publish now, or keep as a draft"}</dd></div>
        </dl>
        <ul className="pw-review-variants">
          {summaryRows.map(({ variant, index, thumb, mainImage, photoCount }) => <li key={variant.clientId}>
            {/* Decorative: the row's text already names the variant and its main image. */}
            <span className="pw-review-thumb">{thumb
              ? <img src={thumb} alt="" />
              : <span className="pw-review-thumb-empty" aria-hidden="true">—</span>}</span>
            <span className="pw-review-body">
              <strong>{variantTitle(variant, index)}{!variant.isActive && <em className="pw-archived-badge">Archived</em>}</strong>
              <span>{variantDisplayName(variant)} · SKU {variant.sku || "—"} · ₹{variant.price || "—"}
                · {variant.quantityAvailable} in stock · {photoCount} photo(s)</span>
              {mainImage && <small>Main image: {mainImage}</small>}
              {!photoCount && <small>No photos — the storefront will show the placeholder.</small>}
            </span>
          </li>)}
        </ul>
        {uploadProgress && <p className="upload-progress" role="status">
          Uploading {uploadProgress.name} for {uploadProgress.variant}…</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => setStep(2)}>Back</button>
          {editing
            ? <button type="button" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Save changes"}</button>
            : <>
              <button type="button" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Save as draft"}</button>
              <button type="button" className="pw-publish" disabled={saving} onClick={() => save(true)}>
                {saving ? "Saving…" : "Publish product"}</button>
            </>}
        </div>
      </div>}
    </form>
  </div>;
}
