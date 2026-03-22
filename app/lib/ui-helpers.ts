export function relativeTime(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(date).toLocaleDateString();
}

export function daysUntil(date: Date | string): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

export function formatAction(action: string): string {
  const map: Record<string, string> = {
    list: "Listed product",
    delist: "Delisted product",
    update: "Updated listing",
    reconcile: "Reconciled inventory",
    price_update: "Price updated",
  };
  return map[action] ?? action;
}

export type ActionIconType =
  | "plus-circle"
  | "minus-circle"
  | "refresh"
  | "arrows-out-horizontal"
  | "cash-dollar"
  | "circle";

export function actionIcon(action: string): ActionIconType {
  const map: Record<string, ActionIconType> = {
    list: "plus-circle",
    delist: "minus-circle",
    update: "refresh",
    reconcile: "arrows-out-horizontal",
    price_update: "cash-dollar",
  };
  return map[action] ?? "circle";
}
