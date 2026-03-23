import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  description?: string;
  background?: "subdued";
  children?: ReactNode;
  href?: string;
}

export function StatCard({
  label,
  value,
  description,
  background,
  children,
  href,
}: StatCardProps) {
  const card = (
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

  if (href) {
    return (
      <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {card}
      </a>
    );
  }

  return card;
}
