import { useState, useEffect } from "react";
import { relativeTime } from "./ui-helpers";

export function useRelativeTime(date: Date | string): string {
  const [text, setText] = useState("");

  useEffect(() => {
    setText(relativeTime(date));
    const interval = setInterval(() => setText(relativeTime(date)), 60_000);
    return () => clearInterval(interval);
  }, [date]);

  return text;
}
