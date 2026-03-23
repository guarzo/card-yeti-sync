export default function PrivacyPolicy() {
  return (
    <s-page heading="Privacy Policy">
      <s-box padding="large" borderWidth="base" borderRadius="base">
        <s-stack direction="block" gap="base" padding="large">
          <s-text type="strong">Card Yeti Sync — Privacy Policy</s-text>
          <s-text>Last updated: March 2026</s-text>

          <s-text type="strong">What We Collect</s-text>
          <s-text>
            Card Yeti Sync accesses your Shopify product data (titles, descriptions,
            prices, images, inventory, and card metafields) to sync listings to
            connected marketplaces. We store marketplace connection tokens and sync
            status records in our database.
          </s-text>

          <s-text type="strong">What We Don&apos;t Collect</s-text>
          <s-text>
            We do not collect, store, or process customer personal information.
            The app only works with product and inventory data. We do not sell or
            share any data with third parties beyond the marketplace APIs you
            explicitly connect.
          </s-text>

          <s-text type="strong">Marketplace Connections</s-text>
          <s-text>
            When you connect a marketplace (eBay, Whatnot, Helix), we store OAuth
            tokens securely in our database. These tokens are only used to
            communicate with the marketplace&apos;s API on your behalf. You can
            disconnect at any time, which deletes the stored tokens.
          </s-text>

          <s-text type="strong">Data Deletion</s-text>
          <s-text>
            Uninstalling the app automatically deletes all stored data including
            marketplace connections, listing records, sync logs, and price
            suggestions. You can also request data deletion by contacting us.
          </s-text>

          <s-text type="strong">Contact</s-text>
          <s-text>
            Questions about this policy? Contact us at privacy@cardyeti.com.
          </s-text>
        </s-stack>
      </s-box>
    </s-page>
  );
}
