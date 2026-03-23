import { useFetcher } from "react-router";

interface DisconnectButtonProps {
  marketplace: string;
}

export function DisconnectButton({ marketplace }: DisconnectButtonProps) {
  const fetcher = useFetcher();
  const isDisconnecting = fetcher.state === "submitting";

  return (
    <fetcher.Form
      method="post"
      onSubmit={(e) => {
        if (
          !confirm(
            `Disconnect ${marketplace}? Active listings will stop syncing.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="intent" value="disconnect" />
      <s-button
        variant="tertiary"
        tone="critical"
        type="submit"
        disabled={isDisconnecting || undefined}
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect"}
      </s-button>
    </fetcher.Form>
  );
}
