import type { ReactNode } from "react";

interface ConnectionCardProps {
  marketplace: string;
  connected: boolean;
  icon: string;
  connectDescription: string;
  connectAction?: ReactNode;
  connectFooter?: ReactNode;
  children?: ReactNode;
  disconnectAction?: ReactNode;
}

export function ConnectionCard({
  marketplace,
  connected,
  icon,
  connectDescription,
  connectAction,
  connectFooter,
  children,
  disconnectAction,
}: ConnectionCardProps) {
  if (connected) {
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-icon type="check-circle-filled" tone="success" />
              <s-text type="strong">{marketplace} account connected</s-text>
            </s-stack>
            {disconnectAction}
          </s-stack>
          {children && (
            <>
              <s-divider />
              {children}
            </>
          )}
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box padding="large" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="base" alignItems="center">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <s-icon type={icon as any} color="subdued" />
        <s-text type="strong">Connect to {marketplace}</s-text>
        <s-paragraph color="subdued">{connectDescription}</s-paragraph>
        {connectAction}
        {connectFooter}
      </s-stack>
    </s-box>
  );
}
