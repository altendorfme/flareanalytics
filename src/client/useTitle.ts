import { useEffect } from "react";

/** Per-page tab title ("example.com · Traffic · FlareAnalytics"). */
export function useTitle(...parts: (string | null | undefined)[]) {
  const title = [...parts.filter(Boolean), "FlareAnalytics"].join(" · ");
  useEffect(() => { document.title = title; }, [title]);
}
