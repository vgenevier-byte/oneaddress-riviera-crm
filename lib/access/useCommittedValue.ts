"use client";

import { useLayoutEffect, useRef } from "react";

// Async callbacks see the latest committed identity/data, never a render that
// React may suspend or abandon. Updating this ref does not schedule a save.
export function useCommittedValue<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; }, [value]);
  return ref;
}
