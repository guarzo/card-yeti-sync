import { useState, useEffect } from "react";
import { relativeTime } from "./ui-helpers";

export function useRelativeTime(date: Date | string): string {
  const [text, setText] = useState(() => relativeTime(date));

  // Track date changes and update text synchronously during render
  const [prevDate, setPrevDate] = useState(date);
  if (date !== prevDate) {
    setPrevDate(date);
    setText(relativeTime(date));
  }

  useEffect(() => {
    const interval = setInterval(() => setText(relativeTime(date)), 60_000);
    return () => clearInterval(interval);
  }, [date]);

  return text;
}
