import '@shopify/ui-extensions';

// @ts-expect-error module augmentation for Shopify UI extensions
declare module './src/BlockExtension.jsx' {
  const shopify: import('@shopify/ui-extensions/admin.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
