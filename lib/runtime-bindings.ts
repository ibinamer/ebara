import { AsyncLocalStorage } from "node:async_hooks";

export type D1PreparedStatementBinding = {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  first<T extends Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type D1DatabaseBinding = {
  prepare(query: string): D1PreparedStatementBinding;
};

export type RuntimeBindings = {
  DB?: D1DatabaseBinding;
};

const bindingsStorage = new AsyncLocalStorage<RuntimeBindings>();

/** Keeps Cloudflare bindings isolated to the request that owns them. */
export function runWithRuntimeBindings<T>(
  bindings: RuntimeBindings,
  callback: () => T,
): T {
  return bindingsStorage.run(bindings, callback);
}

export function getRuntimeD1Database(): D1DatabaseBinding | null {
  return bindingsStorage.getStore()?.DB ?? null;
}
