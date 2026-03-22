import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  description?: string;
  background?: "subdued";
  children?: ReactNode;
}

export function StatCard({
  label,
  value,
  description,
  background,
  children,
}: StatCardProps) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={background}
    >
      <s-stack direction="block" gap="small">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong">{value}</s-text>
        {description && (
          <s-paragraph color="subdued">{description}</s-paragraph>
        )}
        {children}
      </s-stack>
    </s-box>
  );
}
