import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Card Yeti Sync</h1>
        <p className={styles.text}>
          Sync your Shopify card inventory to eBay, Whatnot, and Helix from one
          dashboard.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Multi-marketplace sync</strong>. List products on eBay,
            Whatnot, and Helix directly from your Shopify store.
          </li>
          <li>
            <strong>Automatic delisting</strong>. When a card sells on any
            channel, it&apos;s removed from the others instantly.
          </li>
          <li>
            <strong>Inventory tracking</strong>. Real-time inventory updates
            keep your listings accurate across every platform.
          </li>
        </ul>
      </div>
    </div>
  );
}
