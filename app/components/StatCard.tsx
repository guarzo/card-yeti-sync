import type { ReactNode } from "react";

const TONE_COLORS: Record<string, string> = {
  info: "#2563eb",
  success: "#16a34a",
  critical: "#dc2626",
  caution: "#d97706",
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  description?: string;
  background?: "subdued";
  children?: ReactNode;
  href?: string;
  tone?: "info" | "success" | "critical" | "caution" | "neutral";
}

export function StatCard({
  label,
  value,
  description,
  background,
  children,
  href,
  tone,
}: StatCardProps) {
  const borderColor = tone && tone !== "neutral" ? TONE_COLORS[tone] : undefined;

  const card = (
    <div style={borderColor ? { borderLeft: `3px solid ${borderColor}`, borderRadius: "8px" } : undefined}>
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
    </div>
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
