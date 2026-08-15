import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as ReactRouter from "react-router-dom";
import ProductDetail from "./ProductDetail";
import { StoreContext } from "../../context/StoreContext";
import { getProductBySlug, getCanonicalProductSlug } from "../../services/api";

jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user:null }) }));
jest.mock("../../components/ProductReviews/ProductReviews", () => () => null);
jest.mock("../../services/api", () => ({
  getProductBySlug: jest.fn(),
  getCanonicalProductSlug: jest.fn(),
}));

const product = { _id:"14", productId:14, name:"Rayban", brand:"Shades World", description:"Frame", price:1999,
  // The product-family shape: every photo belongs to exactly one variant, each variant leads with
  // its own MAIN image (isPrimary), and Blue at position 1 is the family's Main Product.
  image:"/blue.jpg", imageAlt:"Rayban", images:[
    { imageId:2, imageUrl:"/blue.jpg", variantId:13, isPrimary:true }, { imageId:4, imageUrl:"/blue-2.jpg", variantId:13 },
    { imageId:3, imageUrl:"/pink.jpg", variantId:14, isPrimary:true }, { imageId:5, imageUrl:"/pink-2.jpg", variantId:14 }],
  categories:[{ categoryName:"Unisex" }], category:"Unisex", attributes:{}, isNew:false, defaultVariantId:13,
  variants:[{ variantId:13, position:1, mainVariant:true, variantName:"Blue", sku:"BLUE", price:1999, quantityAvailable:3, lowStockThreshold:1, attributes:{ color:"Blue" } },
    { variantId:14, position:2, mainVariant:false, variantName:"Pink", sku:"PINK", price:2099, quantityAvailable:4, lowStockThreshold:1, attributes:{ color:"Pink" } }] };
// The route the bug was reported on: a single variant, so "the variant next to the
// primary tile" and "the default variant" are the same line.
const singleVariant = { ...product, _id:"19", productId:19, name:"women", price:123, image:"/w-main.jpg",
  images:[{ imageId:16, imageUrl:"/w-main.jpg", variantId:21, isPrimary:true }, { imageId:17, imageUrl:"/w-ggg.jpg", variantId:21 }],
  defaultVariantId:21, color:"GGG",
  variants:[{ variantId:21, position:1, mainVariant:true, variantName:"423tr", sku:"24234234", price:123, quantityAvailable:1, lowStockThreshold:1, attributes:{ color:"GGG" } }] };

/**
 * The fixtures above are in the storefront's mapped shape, which is what this page used to read
 * straight out of StoreContext. It now fetches the product itself and maps the API response, so the
 * mock has to answer in the API's shape and let mapProduct do its job — otherwise these tests would
 * be exercising a mapping the application never performs.
 */
const apiShape = (mapped) => ({
  productId: mapped.productId,
  slug: mapped.slug || `product-${mapped.productId}`,
  productName: mapped.name,
  brand: mapped.brand,
  productDescription: mapped.description,
  basePrice: mapped.price,
  isActive: true,
  isNew: mapped.isNew,
  categories: mapped.categories,
  attributes: mapped.attributes,
  images: mapped.images,
  // mapProduct drops inactive variants, and none of these fixtures set the flag.
  variants: mapped.variants.map((variant) => ({ isActive: true, ...variant })),
});

const buildStore = (cartItems, list = [product]) => ({ product_list:list, productsLoading:false, cartItems,
  addToCart:jest.fn(), removeFromCart:jest.fn(), isWishlisted:()=>false, toggleWishlist:jest.fn() });

/**
 * Renders and waits for the fetch to land. Every test awaits this: the page is asynchronous now, and
 * asserting synchronously would only ever see "Loading product…".
 */
const renderDetail = async (store, source = product, slug = "rayban") => {
  getProductBySlug.mockResolvedValue(apiShape(source));
  const utils = render(<MemoryRouter initialEntries={[`/product/${slug}`]}><StoreContext.Provider value={store}>
    <Routes><Route path="/product/:slug" element={<ProductDetail />} /></Routes></StoreContext.Provider></MemoryRouter>);
  await screen.findByRole("heading", { level:1 });
  return utils;
};

beforeEach(() => {
  getProductBySlug.mockReset();
  getCanonicalProductSlug.mockReset();
});

// ── Slug routing ──────────────────────────────────────────────────────────────────────────

test("the page fetches the product named in the URL rather than reading the cached listing", async () => {
  // The old lookup was product_list.find(...), so a product absent from the 200-item listing
  // rendered "Product not found". An empty list here would have failed that way.
  await renderDetail(buildStore({}, []));
  expect(getProductBySlug).toHaveBeenCalledWith("rayban");
  expect(screen.getByRole("heading", { level:1, name:"Rayban" })).toBeInTheDocument();
});

test("a legacy numeric product URL is redirected to the canonical slug and never rendered as-is", async () => {
  getCanonicalProductSlug.mockResolvedValue({ slug:"classic-aviator" });
  getProductBySlug.mockResolvedValue(apiShape({ ...product, slug:"classic-aviator" }));
  render(<MemoryRouter initialEntries={["/product/22"]}><StoreContext.Provider value={buildStore({})}>
    <Routes><Route path="/product/:slug" element={<ProductDetail />} /></Routes></StoreContext.Provider></MemoryRouter>);
  await waitFor(() => expect(getCanonicalProductSlug).toHaveBeenCalledWith("22"));
  // The numeric id resolves through the canonical endpoint, then the slug route fetches the product.
  await waitFor(() => expect(getProductBySlug).toHaveBeenCalledWith("classic-aviator"));
  expect(await screen.findByRole("heading", { level:1, name:"Rayban" })).toBeInTheDocument();
});

test("an unknown slug renders not-found rather than an empty product page", async () => {
  getProductBySlug.mockRejectedValue(Object.assign(new Error("Product not found"), { status:404 }));
  render(<MemoryRouter initialEntries={["/product/does-not-exist"]}><StoreContext.Provider value={buildStore({})}>
    <Routes><Route path="/product/:slug" element={<ProductDetail />} /></Routes></StoreContext.Provider></MemoryRouter>);
  expect(await screen.findByText("Product not found")).toBeInTheDocument();
});

// ── Gallery ───────────────────────────────────────────────────────────────────────────────

const mainPhoto = (container) => container.querySelector(".pg-frame img");

test("the gallery leads with the selected variant's photo and every control is type=button", async () => {
  const { container } = await renderDetail(buildStore({}));
  // Blue is the default variant, so its photo leads — not the product's primary shot.
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
  // A submit-type control inside the page would reload it on click.
  [...container.querySelectorAll(".pg button")].forEach((button) => {
    expect(button).toHaveAttribute("type", "button");
  });
});

test("changing the photo does not change what Add to Bag buys", async () => {
  const store = buildStore({});
  const { container } = await renderDetail(store);
  fireEvent.click(screen.getByRole("button", { name:"Rayban Pink Pink" }));
  expect(mainPhoto(container)).toHaveAttribute("src", "/pink.jpg");
  // Pink's gallery is exactly its own two photos — nothing borrowed, nothing appended.
  fireEvent.click(screen.getByRole("button", { name:"Show photo 2 of 2" }));
  expect(mainPhoto(container)).toHaveAttribute("src", "/pink-2.jpg");
  expect(screen.getByText("₹2,099")).toBeInTheDocument();
  expect(screen.getByText("4 in stock · SKU PINK")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name:"Add Pink to bag" }));
  expect(store.addToCart).toHaveBeenCalledWith("14", 14);
});

test("Next and Previous move through the gallery and wrap", async () => {
  const { container } = await renderDetail(buildStore({}));
  // Blue's main image leads, its additional photo follows, and Next wraps back round.
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
  fireEvent.click(screen.getByRole("button", { name:"Next photo" }));
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue-2.jpg");
  fireEvent.click(screen.getByRole("button", { name:"Next photo" }));
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
  fireEvent.click(screen.getByRole("button", { name:"Previous photo" }));
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue-2.jpg");
});

test("arrow keys move through the gallery", async () => {
  const { container } = await renderDetail(buildStore({}));
  const gallery = container.querySelector(".pg");
  fireEvent.keyDown(gallery, { key:"ArrowRight" });
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue-2.jpg");
  fireEvent.keyDown(gallery, { key:"ArrowLeft" });
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
});

const oduShape = (blackPhotoVariantId) => ({ ...product, images:[
  { imageId:1, imageUrl:"/black-pair.jpg", isPrimary:blackPhotoVariantId === 13, variantId:blackPhotoVariantId },
  { imageId:2, imageUrl:"/black.jpg", variantId:13 },
  { imageId:3, imageUrl:"/blue.jpg", variantId:14, isPrimary:true },
], variants:[
  { ...product.variants[0], variantName:"Ocean Black", attributes:{ color:"Black" }, quantityAvailable:0 },
  { ...product.variants[1], variantName:"Ocean Blue", attributes:{ color:"Blue" }, quantityAvailable:5 },
] });

test("the Main Product's photos never leak into a colourway that has its own", async () => {
  // The ODU complaint, settled by the model: the sold-out Black pair (the Main Product) owns its
  // photographs — legacy variant-less rows included — and Blue's gallery is exactly Blue's own.
  const odu = oduShape(undefined); // the Black pair's photo is a legacy row with no variantId
  const { container } = await renderDetail(buildStore({}, [odu]), odu);
  expect(screen.getByRole("button", { name:/Add Blue to bag/ })).toBeInTheDocument();
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
  expect(screen.queryByRole("button", { name:"Next photo" })).toBeNull();
  expect(container.querySelectorAll(".pg-thumbs img")).toHaveLength(0);
});

test("filing that photo against Black keeps it out of Blue's gallery just the same", async () => {
  const odu = oduShape(13); // now explicitly owned by Ocean Black
  const { container } = await renderDetail(buildStore({}, [odu]), odu);
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
  expect(screen.queryByRole("button", { name:"Next photo" })).toBeNull();
  const sources = [...container.querySelectorAll(".pg-thumbs img")].map((img) => img.getAttribute("src"));
  expect(sources).not.toContain("/black-pair.jpg");
  expect(sources).not.toContain("/black.jpg");
});

// ── Default selection: the Main Product first, with the safe out-of-stock fallback ─────────

test("opens on the Main Product when it is in stock", async () => {
  await renderDetail(buildStore({}));
  expect(screen.getByRole("button", { name:"Add Blue to bag" })).toBeInTheDocument();
  expect(screen.getByText("3 in stock · SKU BLUE")).toBeInTheDocument();
});

test("falls back to the first available variant when the Main Product is sold out", async () => {
  const mainSoldOut = { ...product, variants:[
    { ...product.variants[0], quantityAvailable:0 }, product.variants[1]] };
  const { container } = await renderDetail(buildStore({}, [mainSoldOut]), mainSoldOut);
  // Pink is selected and quoted; Blue is visibly unavailable but still present in the selector.
  expect(screen.getByRole("button", { name:"Add Pink to bag" })).toBeInTheDocument();
  expect(mainPhoto(container)).toHaveAttribute("src", "/pink.jpg");
  expect(screen.getByRole("button", { name:/Rayban Blue Blue Out of stock/ })).toBeDisabled();
});

test("shows the Main Product with a disabled Sold Out state when nothing is purchasable", async () => {
  const allSoldOut = { ...product, variants:[
    { ...product.variants[0], quantityAvailable:0 },
    { ...product.variants[1], quantityAvailable:0 }] };
  const { container } = await renderDetail(buildStore({}, [allSoldOut]), allSoldOut);
  // The Main Product's information still fronts the page — it is not hidden for being sold out.
  expect(mainPhoto(container)).toHaveAttribute("src", "/blue.jpg");
  expect(screen.getByText("Currently unavailable")).toBeInTheDocument();
  const addButton = container.querySelector(".pd-add-btn");
  expect(addButton).toBeDisabled();
  expect(addButton).toHaveTextContent("Out of stock");
});

test("a ?variant= deep link carries the family position and is honoured when purchasable", async () => {
  getProductBySlug.mockResolvedValue(apiShape(product));
  render(<MemoryRouter initialEntries={["/product/rayban?variant=2"]}><StoreContext.Provider value={buildStore({})}>
    <Routes><Route path="/product/:slug" element={<ProductDetail />} /></Routes></StoreContext.Provider></MemoryRouter>);
  await screen.findByRole("heading", { level:1 });
  expect(screen.getByRole("button", { name:"Add Pink to bag" })).toBeInTheDocument();
});

test("a legacy deep link carrying a raw variant id falls back to the default rule", async () => {
  getProductBySlug.mockResolvedValue(apiShape(product));
  render(<MemoryRouter initialEntries={["/product/rayban?variant=14"]}><StoreContext.Provider value={buildStore({})}>
    <Routes><Route path="/product/:slug" element={<ProductDetail />} /></Routes></StoreContext.Provider></MemoryRouter>);
  await screen.findByRole("heading", { level:1 });
  // 14 is Pink's database id, not a position; it matches nothing and the Main Product is selected.
  expect(screen.getByRole("button", { name:"Add Blue to bag" })).toBeInTheDocument();
});

test("choosing a colour writes its position, not its database id, into the URL", async () => {
  // MemoryRouter keeps the location internal, so it is captured through a probe on the route.
  const seen = { search:"" };
  const CaptureSearch = () => {
    seen.search = ReactRouter.useLocation().search;
    return <ProductDetail />;
  };
  getProductBySlug.mockResolvedValue(apiShape(product));
  render(<MemoryRouter initialEntries={["/product/rayban"]}><StoreContext.Provider value={buildStore({})}>
    <Routes><Route path="/product/:slug" element={<CaptureSearch />} /></Routes></StoreContext.Provider></MemoryRouter>);
  await screen.findByRole("heading", { level:1 });
  fireEvent.click(screen.getByRole("button", { name:"Rayban Pink Pink" }));
  await waitFor(() => expect(seen.search).toBe("?variant=2"));
  // Pink's database id is 14; had the id been written this would be ?variant=14.
});

test("a single-photo gallery hides the navigation controls rather than showing dead ones", async () => {
  const onePhoto = { ...product, images:[{ imageId:1, imageUrl:"/main.jpg", isPrimary:true }] };
  await renderDetail(buildStore({}, [onePhoto]), onePhoto);
  expect(screen.queryByRole("button", { name:"Next photo" })).toBeNull();
  expect(screen.queryByRole("button", { name:"Previous photo" })).toBeNull();
});

test("a product with no photos renders an empty frame, not a broken image", async () => {
  const noPhotos = { ...product, images:[] };
  await renderDetail(buildStore({}, [noPhotos]), noPhotos);
  expect(screen.getByTestId("product-gallery-empty")).toBeInTheDocument();
});

test("non-primary photos are lazy-loaded so a full gallery is not fetched up front", async () => {
  const { container } = await renderDetail(buildStore({}));
  expect(mainPhoto(container)).toHaveAttribute("loading", "eager");
  [...container.querySelectorAll(".pg-thumbs img")].forEach((thumbnail) => {
    expect(thumbnail).toHaveAttribute("loading", "lazy");
  });
});

// ── Variant behaviour, unchanged by the gallery rewrite ───────────────────────────────────

test("variants keep independent cart state", async () => {
  await renderDetail(buildStore({ "14:13":1 }));
  expect(screen.getByText("View bag →")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name:"Rayban Pink Pink" }));
  expect(screen.getByRole("button", { name:"Add Pink to bag" })).toBeInTheDocument();
  expect(screen.getByText("₹2,099")).toBeInTheDocument();
});

test("the bag indicator names the color that was actually added", async () => {
  await renderDetail(buildStore({ "14:14":2 }));
  expect(screen.getByRole("button", { name:"Rayban Pink Pink 2 in bag" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name:"Add Blue to bag" })).toBeInTheDocument();
});

test("single-variant route adds its only variant and attributes the bag state to it", async () => {
  const store = buildStore({}, [singleVariant]);
  await renderDetail(store, singleVariant, "women");
  fireEvent.click(screen.getByRole("button", { name:"Add GGG to bag" }));
  expect(store.addToCart).toHaveBeenCalledWith("19", 21);
  expect(store.addToCart).toHaveBeenCalledTimes(1);
});

test("the colour row holds only colours — the gallery is never part of the purchase choice", async () => {
  const { container } = await renderDetail(buildStore({}, [singleVariant]), singleVariant, "women");
  const tiles = [...container.querySelectorAll(".pd-variant-options button")];
  expect(tiles).toHaveLength(1);
  expect(tiles[0]).toHaveTextContent("GGG");
  expect(tiles[0].className).toBe("active");
  // The gallery lives in the image column, so no photo control can read as "the thing being bought".
  expect(container.querySelector(".pd-variant-options .pg")).toBeNull();
  expect(container.querySelector(".pd-image-section .pg")).not.toBeNull();
});

test("a color still in the bag stays selectable after it sells out, and routes to where it can be removed", async () => {
  const soldOut = { ...product, variants:[product.variants[0],
    { ...product.variants[1], quantityAvailable:0 }] };
  const { container } = await renderDetail(buildStore({ "14:14":1 }, [soldOut]), soldOut);
  const pinkTile = screen.getByRole("button", { name:/Rayban Pink Pink Out of stock 1 in bag/ });
  expect(pinkTile).not.toBeDisabled();
  fireEvent.click(pinkTile);
  // The quantity stepper is gone from this page, so the sold-out line is removed in the bag.
  // What this page must still do is show the state honestly and offer a way through.
  const addButton = container.querySelector(".pd-add-btn");
  expect(addButton).toBeDisabled();
  expect(addButton).toHaveTextContent("Out of stock");
  expect(screen.getByText("View bag →")).toBeInTheDocument();
});

test("no quantity stepper is rendered on the product page once an item is in the bag", async () => {
  const { container } = await renderDetail(buildStore({ "14:13":1 }));
  expect(container.querySelector(".pd-qty-row")).toBeNull();
  expect(container.querySelector(".pd-qty-control")).toBeNull();
  expect(screen.getByText("View bag →")).toBeInTheDocument();
});

test("the add button carries the stock ceiling now that the stepper is gone", async () => {
  // Blue has quantityAvailable 3; with 3 already in the bag the only add affordance must lock,
  // otherwise repeated clicks push past stock until the API rejects them.
  await renderDetail(buildStore({ "14:13":3 }));
  const addButton = screen.getByRole("button", { name:/All 3 in your bag/i });
  expect(addButton).toBeDisabled();
});

const openTab = (name) => fireEvent.click(screen.getByRole("button", { name }));

test("Description shows the selected variant's own copy and switches with the variant", async () => {
  const withCopy = { ...product, description:"Shared product copy",
    variants:[{ ...product.variants[0], variantDescription:"Ocean blue, mirrored." },
      { ...product.variants[1], variantDescription:"Rose gold, gradient." }] };
  await renderDetail(buildStore({}, [withCopy]), withCopy);
  expect(screen.getByText("Ocean blue, mirrored.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name:"Rayban Pink Pink" }));
  expect(screen.getByText("Rose gold, gradient.")).toBeInTheDocument();
  expect(screen.queryByText("Ocean blue, mirrored.")).not.toBeInTheDocument();
});

test("a variant with no copy of its own inherits the product description and says so", async () => {
  const shared = { ...product, description:"Shared product copy" };
  await renderDetail(buildStore({}, [shared]), shared);
  expect(screen.getByText("Shared product copy")).toBeInTheDocument();
  expect(screen.getByText("This description covers every colourway.")).toBeInTheDocument();
});

test("Details renders the selected variant's attributes and changes with the variant", async () => {
  const withAttributes = { ...product, attributes:{ frame_material:"Steel" },
    variants:[{ ...product.variants[0], attributes:{ color:"Blue", lens_color:"Smoke Blue" } },
      { ...product.variants[1], attributes:{ color:"Pink", lens_color:"Rose" } }] };
  await renderDetail(buildStore({}, [withAttributes]), withAttributes);
  openTab("Details");
  expect(screen.getByText(/lens color: Smoke Blue/)).toBeInTheDocument();
  expect(screen.getByText(/SKU: BLUE/)).toBeInTheDocument();
  // Product-level attributes still show, so the tab is not narrower than before.
  expect(screen.getByText(/frame material: Steel/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name:"Rayban Pink Pink" }));
  expect(screen.getByText(/lens color: Rose/)).toBeInTheDocument();
  expect(screen.queryByText(/lens color: Smoke Blue/)).not.toBeInTheDocument();
  expect(screen.getByText(/SKU: PINK/)).toBeInTheDocument();
});

test("a variant attribute overrides a product attribute of the same name rather than listing both", async () => {
  const clashing = { ...product, attributes:{ color:"Assorted", frame_material:"Steel" },
    variants:[{ ...product.variants[0], attributes:{ color:"Blue" } }, product.variants[1]] };
  await renderDetail(buildStore({}, [clashing]), clashing);
  openTab("Details");
  expect(screen.getByText(/color: Blue/)).toBeInTheDocument();
  expect(screen.queryByText(/color: Assorted/)).not.toBeInTheDocument();
});

test("Shipping is derived from the selected variant's real stock", async () => {
  const stockLevels = { ...product,
    variants:[{ ...product.variants[0], quantityAvailable:9, lowStockThreshold:2 },
      { ...product.variants[1], quantityAvailable:1, lowStockThreshold:2 }] };
  await renderDetail(buildStore({}, [stockLevels]), stockLevels);
  openTab("Shipping");
  expect(screen.getByText(/Blue is in stock and dispatches within 1 business day/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name:"Rayban Pink Pink" }));
  expect(screen.getByText(/Only 1 left in Pink/)).toBeInTheDocument();
});

test("Shipping reports a sold-out variant as undispatchable", async () => {
  const soldOut = { ...product,
    variants:[product.variants[0], { ...product.variants[1], quantityAvailable:0 }] };
  await renderDetail(buildStore({ "14:14":1 }, [soldOut]), soldOut);
  fireEvent.click(screen.getByRole("button", { name:/Rayban Pink Pink Out of stock/ }));
  openTab("Shipping");
  expect(screen.getByText(/Pink is out of stock and cannot be dispatched/)).toBeInTheDocument();
});

test("the add button falls back to the variant's own SKU rather than another variant's color", async () => {
  // No attributes.color and no variantName: the old fallback reached product.color,
  // which is resolved from a different variant.
  const unnamed = { ...product, color:"Blue",
    variants:[{ ...product.variants[0], attributes:{}, variantName:null }, product.variants[1]] };
  await renderDetail(buildStore({}, [unnamed]), unnamed);
  expect(screen.getByRole("button", { name:"Add BLUE to bag" })).toBeInTheDocument();
});

test("two variants sharing a color are disambiguated by SKU", async () => {
  const twins = { ...product, variants:[product.variants[0],
    { ...product.variants[1], attributes:{ color:"Blue" }, sku:"BLUE-2" }] };
  await renderDetail(buildStore({}, [twins]), twins);
  expect(screen.getByRole("button", { name:"Add Blue (BLUE) to bag" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name:"Rayban Blue Blue BLUE-2" }));
  expect(screen.getByRole("button", { name:"Add Blue (BLUE-2) to bag" })).toBeInTheDocument();
});
