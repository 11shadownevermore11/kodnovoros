import { useCallback, useEffect, useState } from "react";

type State<T> = { key: string; data: T | null; error: string };

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}

export function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<State<T>>({ key: "", data: null, error: "" });
  const [version, setVersion] = useState(0);
  const actualKey = JSON.stringify([key, version]);
  const reload = useCallback(() => setVersion(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      data => { if (!controller.signal.aborted) setState({ key: actualKey, data, error: "" }); },
      error => { if (!controller.signal.aborted) setState({ key: actualKey, data: null, error: errorMessage(error) }); },
    );
    return () => controller.abort();
    // The key identifies the query, including identity and parameters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualKey]);
  return { data: state.key === actualKey ? state.data : null, error: state.key === actualKey ? state.error : "", loading: state.key !== actualKey, reload };
}
