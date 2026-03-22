import { Form, useNavigation } from "react-router";

interface DisconnectButtonProps {
  marketplace: string;
}

export function DisconnectButton({ marketplace }: DisconnectButtonProps) {
  const navigation = useNavigation();
  const isDisconnecting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "disconnect";

  return (
    <Form
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
    </Form>
  );
}
