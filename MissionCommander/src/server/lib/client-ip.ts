// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// The client IP better-auth's built-in rate limit keys on. better-auth only reads request
// headers, and with none it puts every user in ONE bucket (sign-in: 3 per 10 s for everyone).
// X-Forwarded-For alone is no answer: any client can send one and get a fresh bucket per
// request. So the server resolves the IP itself — the socket peer, or, when that peer is a
// proxy named in TRUSTED_PROXIES, the rightmost X-Forwarded-For hop no trusted proxy added —
// and passes it in a header of its own that a client cannot set.
// Same logic as MissionEngine/src/api/client-ip.ts and MissionDesigner's clientIp.ts.
import { BlockList, isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { MiddlewareHandler } from 'hono';

/** better-auth's `advanced.ipAddress.ipAddressHeaders`. Only this server sets it. */
export const CLIENT_IP_HEADER = 'x-mission-client-ip';

/** Comma-separated IPs and CIDR ranges; unset or blank → null. A bad entry throws, so a
 *  mistyped setting stops startup instead of silently trusting nothing. */
export function parseTrustedProxies(raw: string | undefined): BlockList | null {
  const entries = (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const list = new BlockList();
  for (const entry of entries) {
    const [addr, bits, extra] = entry.split('/');
    const version = isIP(addr ?? '');
    const max = version === 4 ? 32 : 128;
    const prefix = bits === undefined ? max : Number(bits);
    if (version === 0 || extra !== undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      throw new Error(`TRUSTED_PROXIES: "${entry}" is not an IP address or CIDR range`);
    }
    list.addSubnet(addr!, prefix, version === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

function bare(ip: string): string {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : '';
  return isIP(v4) === 4 ? v4 : ip;
}

function isTrusted(list: BlockList, ip: string): boolean {
  return list.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

export function resolveClientIp(peer: string | undefined, forwardedFor: string | undefined, trusted: BlockList | null): string | null {
  if (!peer) return null;
  const p = bare(peer);
  if (isIP(p) === 0) return null;
  if (!trusted || !isTrusted(trusted, p)) return p;
  const hops = (forwardedFor ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = bare(hops[i]!);
    if (isIP(hop) === 0) break;
    if (!isTrusted(trusted, hop)) return hop;
  }
  return p;
}

/** Sets CLIENT_IP_HEADER on the request, replacing any value the client sent. */
export function clientIpMiddleware(trusted: BlockList | null): MiddlewareHandler {
  return async (c, next) => {
    let peer: string | undefined;
    try {
      peer = getConnInfo(c).remote.address;
    } catch {
      peer = undefined; // no socket (app.request in tests)
    }
    const ip = resolveClientIp(peer, c.req.raw.headers.get('x-forwarded-for') ?? undefined, trusted);
    c.req.raw.headers.delete(CLIENT_IP_HEADER);
    if (ip) c.req.raw.headers.set(CLIENT_IP_HEADER, ip);
    await next();
  };
}
