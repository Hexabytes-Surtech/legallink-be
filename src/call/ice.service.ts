import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** A single ICE server entry, shaped for the browser's RTCPeerConnection. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Builds the ICE-server list a browser needs to negotiate a 1:1 WebRTC call.
 *
 * - STUN (free, public Google) is always included — it covers the common case
 *   where the two browsers can reach each other directly (no relay).
 * - TURN (relay fallback for restrictive/symmetric-NAT networks) is fetched
 *   from Metered's free OpenRelay API *server-side*, so the API key never
 *   reaches the client. Credentials are short-lived.
 * - If Metered isn't configured (or the request fails) we silently return
 *   STUN-only — calls still connect on most networks, so the feature degrades
 *   gracefully instead of breaking.
 */
@Injectable()
export class IceService {
  private readonly logger = new Logger(IceService.name);

  // Free public STUN — no credentials, no signup.
  private readonly stun: IceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  /**
   * METERED_API_KEY accepts either of the two keys Metered issues. Resolved on
   * first use and remembered so we don't re-probe with a failing request:
   *  - 'api'    → key works directly on GET /turn/credentials?apiKey=
   *  - 'secret' → key is the account Secret Key; we first POST
   *               /turn/credential?secretKey= to mint a short-lived apiKey,
   *               then fetch the ICE list with that.
   */
  private meteredKeyMode: 'api' | 'secret' | null = null;

  constructor(private readonly config: ConfigService) {}

  async getIceServers(): Promise<IceServer[]> {
    const servers: IceServer[] = [...this.stun];

    const key = this.config.get<string>('METERED_API_KEY');
    const domain = this.config.get<string>('METERED_DOMAIN');
    if (key && domain) {
      try {
        const turn = await this.fetchMeteredTurn(domain, key);
        if (turn) servers.push(...turn);
      } catch (err) {
        this.logger.warn(
          `Could not fetch Metered TURN credentials (${(err as Error).message}) — falling back to STUN-only`,
        );
      }
    }

    // Optional static TURN (e.g. self-hosted coturn or ExpressTURN) as a redundant entry.
    const staticUrl = this.config.get<string>('TURN_URL');
    if (staticUrl) {
      servers.push({
        urls: staticUrl,
        username: this.config.get<string>('TURN_USERNAME'),
        credential: this.config.get<string>('TURN_CREDENTIAL'),
      });
    }

    return servers;
  }

  private async fetchMeteredTurn(domain: string, key: string): Promise<IceServer[] | null> {
    if (this.meteredKeyMode !== 'secret') {
      const direct = await this.fetchIceList(domain, key);
      if (direct) {
        this.meteredKeyMode = 'api';
        return direct;
      }
      if (this.meteredKeyMode === 'api') return null; // worked before; transient failure
    }

    // Key isn't a direct API key — treat it as the Secret Key and mint a
    // short-lived apiKey for this call. Slightly slower but more secure
    // (per-call ephemeral credentials).
    const mint = await fetch(
      `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryInSeconds: 4 * 3600 }),
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!mint.ok) {
      this.logger.warn(`Metered TURN request failed: HTTP ${mint.status} — falling back to STUN-only`);
      return null;
    }
    const cred = (await mint.json()) as { apiKey?: string };
    if (!cred?.apiKey) {
      this.logger.warn('Metered secret-key mint returned no apiKey — falling back to STUN-only');
      return null;
    }
    const viaMint = await this.fetchIceList(domain, cred.apiKey);
    if (viaMint) this.meteredKeyMode = 'secret';
    return viaMint;
  }

  /** GET the ready-made ICE list; null on any non-OK response (4s cap). */
  private async fetchIceList(domain: string, apiKey: string): Promise<IceServer[] | null> {
    const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const turn = (await res.json()) as IceServer[];
    return Array.isArray(turn) ? turn : null;
  }
}
