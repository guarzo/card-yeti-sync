import type { ReactNode } from "react";

// Web components not yet covered by @shopify/polaris-types
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": { children?: ReactNode };
      "s-resource-list": { children?: ReactNode };
      "s-resource-item": { key?: string | number; url?: string; children?: ReactNode };
    }
  }
}
