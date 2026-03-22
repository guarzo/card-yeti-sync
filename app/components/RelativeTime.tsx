import { useRelativeTime } from "../lib/use-relative-time";

export function RelativeTime({ date }: { date: string }) {
  const text = useRelativeTime(date);
  return (
    <s-text color="subdued">
      <span suppressHydrationWarning>{text}</span>
    </s-text>
  );
}
