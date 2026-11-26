// A fixed one-minute window per client and per wider prefix. The counters are the relay's only memory: they hold an
// address prefix and a number, are never logged, and are all dropped when the window turns.
//
// Keys: IPv4 as is, IPv6 by its /64 (one subscriber usually gets a whole /64, so rotating addresses inside it gains
// nothing), IPv4-mapped IPv6 as IPv4. A wider prefix (IPv4 /24, IPv6 /48) gets its own limit, `prefixFactor` times
// the per-client one, so one network can't spread a flood over many addresses. When a table is full the least
// recently seen entry is evicted: a flood of new addresses can at worst reset someone's count, never lock anyone out.
const WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  /** Entries per table before the least recently seen one is evicted. */
  maxClients?: number;
  /** The wider prefix's limit, as a multiple of the per-client limit. */
  prefixFactor?: number;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4(addr: string): number[] | undefined {
  const m = IPV4.exec(addr);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : undefined;
}

/** Eight 16-bit groups, or undefined. Accepts `::`, a zone id and a trailing dotted IPv4. */
function ipv6(raw: string): number[] | undefined {
  let addr = raw.split("%")[0]!.toLowerCase();
  if (!addr.includes(":")) return undefined;
  const tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (tail) {
    const v4 = ipv4(tail[1]!);
    if (!v4) return undefined;
    addr = `${addr.slice(0, tail.index)}:${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return undefined;
  const read = (s: string) => (s ? s.split(":") : []);
  const head = read(halves[0]!);
  const rest = halves.length === 2 ? read(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return undefined;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => parseInt(g, 16));
}

/** The key a client is counted under, and the wider prefix it shares with its neighbors. */
export function clientPrefix(address: string): { key: string; wide: string } {
  const v4 = ipv4(address);
  if (v4) return { key: v4.join("."), wide: `v4:${v4.slice(0, 3).join(".")}` };
  const v6 = ipv6(address);
  if (v6) {
    // IPv4-mapped (::ffff:a.b.c.d): count it as the IPv4 address it is.
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
      const v4m = [v6[6]! >> 8, v6[6]! & 0xff, v6[7]! >> 8, v6[7]! & 0xff];
      return { key: v4m.join("."), wide: `v4:${v4m.slice(0, 3).join(".")}` };
    }
    const hex = v6.map((g) => g.toString(16));
    return { key: `v6:${hex.slice(0, 4).join(":")}`, wide: `v6:${hex.slice(0, 3).join(":")}` };
  }
  return { key: `other:${address.slice(0, 64)}`, wide: "other" };
}

/** Counts in insertion order; touching an entry moves it to the end, so the first one is the least recently seen. */
class LruCounts {
  readonly #max: number;
  readonly #map = new Map<string, number>();

  constructor(max: number) {
    this.#max = max;
  }

  /** Reads and marks as just seen. */
  touch(key: string): number {
    const n = this.#map.get(key) ?? 0;
    this.#map.delete(key);
    this.#map.set(key, n);
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value as string);
    return n;
  }

  set(key: string, n: number): void {
    this.#map.delete(key);
    this.#map.set(key, n);
  }

  get size(): number {
    return this.#map.size;
  }
}

export class RateLimiter {
  readonly #limit: number;
  readonly #prefixLimit: number;
  readonly #max: number;
  readonly #now: () => number;
  #window = -1;
  #clients: LruCounts;
  #prefixes: LruCounts;

  constructor(perMinute: number, now: () => number, opts: RateLimiterOptions = {}) {
    this.#limit = perMinute;
    this.#prefixLimit = perMinute * (opts.prefixFactor ?? 10);
    this.#max = opts.maxClients ?? 50_000;
    this.#now = now;
    this.#clients = new LruCounts(this.#max);
    this.#prefixes = new LruCounts(this.#max);
  }

  allow(address: string): boolean {
    const window = Math.floor(this.#now() / WINDOW_MS);
    if (window !== this.#window) {
      this.#window = window;
      this.#clients = new LruCounts(this.#max);
      this.#prefixes = new LruCounts(this.#max);
    }
    const { key, wide } = clientPrefix(address);
    const n = this.#clients.touch(key);
    const w = this.#prefixes.touch(wide);
    if (n >= this.#limit || w >= this.#prefixLimit) return false;
    this.#clients.set(key, n + 1);
    this.#prefixes.set(wide, w + 1);
    return true;
  }

  /** Entries in the per-client table (for tests and health). */
  size(): number {
    return this.#clients.size;
  }

  retryAfterSeconds(): number {
    return Math.max(1, Math.ceil(((this.#window + 1) * WINDOW_MS - this.#now()) / 1000));
  }
}
