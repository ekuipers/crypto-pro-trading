// src/testUtils/fetchStub.js
//
// Hand-rolled globalThis.fetch stub shared across this project's network-
// module tests (apiClient, trade, marketData, scout, runEvaluation). Kept
// zero-dependency, consistent with the rest of the Node port.
//
// `responses` is either an array of `{ status, body, statusText? }` objects
// consumed in call order, or a function `(url, init, callIndex) => response`
// for cases where the response needs to depend on the request (e.g.
// pagination, per-symbol quotes).

export function stubFetch(responses) {
  const original = globalThis.fetch;
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    const callIndex = i++;
    calls.push({ url, init });
    const r = typeof responses === "function" ? responses(url, init, callIndex) : responses[callIndex];
    if (!r) {
      throw new Error(`fetchStub: no response configured for call #${callIndex} (${init.method || "GET"} ${url})`);
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.statusText ?? "",
      json: async () => r.body,
    };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
