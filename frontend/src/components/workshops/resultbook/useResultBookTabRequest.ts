// The result workspace's half of "Open saved result" (lane RB3): when a tool
// asked to open THIS result on its book (store/resultBookRequest), switch to
// the Result book tab once and consume the request.

import { useEffect } from "react";

import { useResultBookRequest } from "../../../store/resultBookRequest";

export function useResultBookTabRequest(resultId: string | undefined, hasBook: boolean, showBook: () => void): void {
  const bookFor = useResultBookRequest((state) => state.bookFor);
  const consume = useResultBookRequest((state) => state.consume);
  useEffect(() => {
    if (!bookFor || bookFor !== resultId) return;
    consume();
    if (hasBook) showBook();
  }, [bookFor, consume, hasBook, resultId, showBook]);
}
