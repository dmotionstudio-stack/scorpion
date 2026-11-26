// Where sign-in codes, rate limits and the order index are kept.
//
// On Cloudflare that is a KV namespace bound as AUTH_KV (wrangler.toml). When the code runs without a
// Worker (the local preview server, tests) there is no env, and a copy in memory stands in for it.
// A Worker without the binding gets nothing at all: an in-memory copy would lose codes between requests.

const memory = new Map();

export const memoryKV = {
  async get(key) {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expires && entry.expires < Date.now()) { memory.delete(key); return null; }
    return entry.value;
  },
  async put(key, value, options = {}) {
    memory.set(key, { value: String(value), expires: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0 });
  },
  async delete(key) { memory.delete(key); },
};

export const resetMemoryKV = () => memory.clear();

export const kvFor = (env) => (env ? env.AUTH_KV || null : memoryKV);
