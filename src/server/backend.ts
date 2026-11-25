// What the live side needs from a shared store: publish and subscribe, a few
// small hashes, and counters that expire. In production this is Redis (Upstash),
// so every function instance sees the same thing. Without REDIS_URL it is this
// process's memory, which is enough for `next dev` and for tests.

import { EventEmitter } from "node:events";

import { Redis } from "ioredis";

export interface Backend {
  publish(channel: string, message: string): Promise<void>;
  /** Returns the function that stops listening. */
  subscribe(channel: string, listener: (message: string) => void): Promise<() => void>;
  hset(key: string, field: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | undefined>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<void>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | undefined>;
  /** Add one to a counter that starts over after `ttlSeconds`, and return it. */
  count(key: string, ttlSeconds: number): Promise<number>;
}

/** Hashes are refreshed while anyone is connected; a workspace nobody has open lets them lapse. */
const HASH_TTL = 60 * 60;

class RedisBackend implements Backend {
  private commands: Redis;
  private subscriber?: Redis;
  private listeners = new Map<string, Set<(message: string) => void>>();

  constructor(private readonly url: string) {
    this.commands = new Redis(url, { maxRetriesPerRequest: 2 });
    this.commands.on("error", (error) => console.error("Redis:", error.message));
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.commands.publish(channel, message);
  }

  async subscribe(channel: string, listener: (message: string) => void): Promise<() => void> {
    if (!this.subscriber) {
      // A connection that is subscribed can do nothing else, so it gets its own.
      this.subscriber = new Redis(this.url, { maxRetriesPerRequest: null });
      this.subscriber.on("error", (error) => console.error("Redis subscriber:", error.message));
      this.subscriber.on("message", (name: string, message: string) => {
        for (const each of this.listeners.get(name) ?? []) each(message);
      });
    }
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(channel) === set) {
        this.listeners.delete(channel);
        void this.subscriber?.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.commands.multi().hset(key, field, value).expire(key, HASH_TTL).exec();
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    return (await this.commands.hget(key, field)) ?? undefined;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.commands.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    if (fields.length) await this.commands.hdel(key, ...fields);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.commands.set(key, value, "EX", ttlSeconds);
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.commands.get(key)) ?? undefined;
  }

  async count(key: string, ttlSeconds: number): Promise<number> {
    const results = await this.commands.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
    return Number(results?.[0]?.[1] ?? 0);
  }
}

class MemoryBackend implements Backend {
  private bus = new EventEmitter().setMaxListeners(0);
  private hashes = new Map<string, Map<string, string>>();
  private values = new Map<string, { value: string; until: number }>();

  async publish(channel: string, message: string): Promise<void> {
    this.bus.emit(channel, message);
  }

  async subscribe(channel: string, listener: (message: string) => void): Promise<() => void> {
    this.bus.on(channel, listener);
    return () => this.bus.off(channel, listener);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    let hash = this.hashes.get(key);
    if (!hash) this.hashes.set(key, (hash = new Map()));
    hash.set(field, value);
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    for (const field of fields) this.hashes.get(key)?.delete(field);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.values.get(key);
    if (entry && entry.until < Date.now()) this.values.delete(key);
    return this.values.get(key)?.value;
  }

  async count(key: string, ttlSeconds: number): Promise<number> {
    const current = Number((await this.get(key)) ?? 0) + 1;
    const until = this.values.get(key)?.until ?? Date.now() + ttlSeconds * 1000;
    this.values.set(key, { value: String(current), until });
    return current;
  }
}

const holder = globalThis as { quickmockBackend?: Backend };

export function backend(): Backend {
  if (!holder.quickmockBackend) {
    const url = process.env.REDIS_URL ?? process.env.KV_URL;
    if (!url && process.env.VERCEL) {
      // Instances do not share memory, so live updates would reach only some pages.
      console.warn("REDIS_URL is not set: live updates will not cross function instances. Add Upstash Redis to this project.");
    }
    holder.quickmockBackend = url ? new RedisBackend(url) : new MemoryBackend();
  }
  return holder.quickmockBackend;
}
