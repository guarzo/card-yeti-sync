import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: string;
  heading: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  heading,
  description,
  action,
}: EmptyStateProps) {
  return (
    <s-box padding="large" borderRadius="base">
      <s-stack direction="block" gap="base" alignItems="center">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <s-icon type={icon as any} color="subdued" />
        <s-text type="strong">{heading}</s-text>
        <s-paragraph color="subdued">{description}</s-paragraph>
        {action}
      </s-stack>
    </s-box>
  );
}
