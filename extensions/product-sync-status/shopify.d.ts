import '@shopify/ui-extensions';

// @ts-expect-error -- ambient module declaration for JSX extension file
declare module './src/BlockExtension.jsx' {
  const shopify: import('@shopify/ui-extensions/admin.product-details.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
