/**
 * Relay source adapter (spec 5.2): read Drupal JSON:API through the
 * authorised Hetzner relay instead of the public pages.
 *
 * Column names verified against the live Supabase schema via MCP on
 * 27 Aug 2026: agent_relay_requests(id, workspace_id, connection_id, method,
 * path, headers jsonb, body jsonb, status, response_status,
 * response_body jsonb, error, created_at, claimed_at, completed_at,
 * expires_at).
 *
 * Security posture mirrors the daemon's own rules: relative paths only, GET
 * only from this adapter, no Authorization/Host headers on the queue. The
 * service key comes from the environment and is never logged.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = 180_000;

export interface RelayConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly workspaceId: string;
  readonly connectionId: string;
}

export function relayConfigFromEnv(): RelayConfig | null {
  const supabaseUrl = process.env.RELAY_SUPABASE_URL;
  const serviceRoleKey = process.env.RELAY_SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.RELAY_WORKSPACE_ID;
  const connectionId = process.env.RELAY_CONNECTION_ID;
  if (!supabaseUrl || !serviceRoleKey || !workspaceId || !connectionId) return null;
  return { supabaseUrl, serviceRoleKey, workspaceId, connectionId };
}

function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//') || path.includes('://')) return false;
  if (/[\\\r\n]/.test(path)) return false;
  return true;
}

export class RelayClient {
  #client: SupabaseClient;
  #config: RelayConfig;

  constructor(config: RelayConfig) {
    this.#config = config;
    this.#client = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Enqueue one GET and block-poll for the daemon's answer. */
  async get(path: string): Promise<unknown> {
    if (!isSafeRelativePath(path)) {
      throw new Error(`relay: refusing unsafe path ${path}`);
    }

    const { data: inserted, error: insertError } = await this.#client
      .from('agent_relay_requests')
      .insert({
        workspace_id: this.#config.workspaceId,
        connection_id: this.#config.connectionId,
        method: 'GET',
        path,
        headers: { Accept: 'application/vnd.api+json' },
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      throw new Error(`relay: enqueue failed (${insertError?.code ?? 'no id'})`);
    }

    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const { data: row, error } = await this.#client
        .from('agent_relay_requests')
        .select('status, response_status, response_body, error')
        .eq('id', inserted.id)
        .single();
      if (error) throw new Error(`relay: poll failed (${error.code})`);

      if (row.status === 'completed') {
        if (row.response_status !== null && row.response_status >= 400) {
          throw new Error(`relay: Drupal answered ${row.response_status} for ${path}`);
        }
        return row.response_body;
      }
      if (row.status === 'failed') throw new Error(`relay: ${row.error ?? 'failed'}`);
      if (row.status === 'expired') throw new Error(`relay: request expired for ${path}`);
      if (Date.now() > deadline) throw new Error(`relay: timeout for ${path}`);
    }
  }
}
