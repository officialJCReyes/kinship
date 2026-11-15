// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';

/** The value, but only after it has stopped changing for `ms` (so typing does not search on every key). */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
