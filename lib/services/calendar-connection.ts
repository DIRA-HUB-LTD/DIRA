import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { connectionSecretIsUsable, open, seal } from "@/lib/auth/secret-box";
import { getPool } from "@/lib/db/client";
import { connectMcpServer } from "@/lib/agent/mcp-client";
import { getKeeperEventCount, getKeeperMcpEndpoint } from "@/lib/external-mcp/calendar";

const STATE_TTL_MINUTES = 10;

export class CalendarConnectionError extends Error {
  constructor(
    public readonly code: "not_configured" | "not_connected" | "bad_state" | "authorization_failed",
    message: string,
  ) {
    super(message);
    this.name = "CalendarConnectionError";
  }
}

interface ConnectionSecrets {
  client_information?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  code_verifier?: string;
}

type Who = { teacher_id: string; school_id: string };

export interface ConnectionStatus {
  configured: boolean;
  status: "none" | "pending" | "connected" | "revoked";
  connected_at: string | null;
  last_checked_at: string | null;
}

function connectionSecret(): string | undefined {
  return process.env.DIRA_CONNECTION_SECRET?.trim();
}

export function calendarConnectionIsConfigured(): boolean {
  return connectionSecretIsUsable(connectionSecret());
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/**
 * OAuth client state for one teacher's Keeper connection. Everything the SDK asks us to
 * remember lives in `secrets`, which the service stores encrypted. Nothing here is ever
 * sent to the browser except the authorization URL the teacher is redirected to.
 */
export class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  stateValue: string | null = null;

  constructor(
    readonly secrets: ConnectionSecrets,
    private readonly redirect: string,
    private readonly persist: () => Promise<void> = async () => {},
  ) {}

  get redirectUrl() {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "DIRA",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // Keeper's tools can also create and delete events. DIRA only ever reads, so ask for read.
      scope: "keeper.read",
    };
  }
  state() {
    this.stateValue = randomBytes(24).toString("base64url");
    return this.stateValue;
  }
  clientInformation() {
    return this.secrets.client_information;
  }
  async saveClientInformation(information: OAuthClientInformationMixed) {
    this.secrets.client_information = information;
  }
  tokens() {
    return this.secrets.tokens;
  }
  async saveTokens(tokens: OAuthTokens) {
    this.secrets.tokens = tokens;
    await this.persist();
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  async saveCodeVerifier(verifier: string) {
    this.secrets.code_verifier = verifier;
  }
  codeVerifier() {
    if (!this.secrets.code_verifier) throw new Error("No PKCE code verifier saved");
    return this.secrets.code_verifier;
  }
}

async function loadRow(teacher: Who) {
  const result = await getPool().query<{
    status: ConnectionStatus["status"];
    secrets_encrypted: string | null;
    oauth_state_hash: string | null;
    oauth_state_expires_at: Date | null;
    connected_at: Date | null;
    last_checked_at: Date | null;
  }>(
    `SELECT status, secrets_encrypted, oauth_state_hash, oauth_state_expires_at,
            connected_at, last_checked_at
     FROM calendar_connections WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
    [teacher.teacher_id, teacher.school_id],
  );
  return result.rows[0] ?? null;
}

function readSecrets(sealed: string | null): ConnectionSecrets {
  const plain = open(sealed, connectionSecret());
  if (!plain) return {};
  try {
    return JSON.parse(plain) as ConnectionSecrets;
  } catch {
    return {};
  }
}

async function saveSecrets(teacher: Who, secrets: ConnectionSecrets) {
  await getPool().query(
    `UPDATE calendar_connections SET secrets_encrypted = $3, updated_at = NOW()
     WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
    [teacher.teacher_id, teacher.school_id, seal(JSON.stringify(secrets), connectionSecret()!)],
  );
}

function requireConfigured() {
  if (!calendarConnectionIsConfigured()) {
    throw new CalendarConnectionError(
      "not_configured",
      "Calendar connection is not configured on this server.",
    );
  }
}

export async function getConnectionStatus(teacher: Who): Promise<ConnectionStatus> {
  const row = await loadRow(teacher);
  return {
    configured: calendarConnectionIsConfigured(),
    status: row?.status ?? "none",
    connected_at: row?.connected_at?.toISOString() ?? null,
    last_checked_at: row?.last_checked_at?.toISOString() ?? null,
  };
}

async function markConnected(teacher: Who) {
  await getPool().query(
    `UPDATE calendar_connections
        SET status = 'connected', connected_at = NOW(), oauth_state_hash = NULL,
            oauth_state_expires_at = NULL, updated_at = NOW()
      WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
    [teacher.teacher_id, teacher.school_id],
  );
  await getPool().query(
    "UPDATE schools SET setup_completed_at = COALESCE(setup_completed_at, NOW()) WHERE school_id = $1",
    [teacher.school_id],
  );
}

/**
 * Begin connecting the teacher's calendar. Returns the Keeper authorization URL to send the
 * browser to (or "connected" if Keeper already trusts us). Starting again discards any
 * earlier half-finished attempt and its stored secrets.
 */
export async function startConnection(
  teacher: Who,
  redirectUri: string,
): Promise<{ status: "redirect"; authorization_url: string } | { status: "connected" }> {
  requireConfigured();
  await getPool().query(
    `INSERT INTO calendar_connections (teacher_id, school_id, provider, status)
     VALUES ($1, $2, 'keeper', 'pending')
     ON CONFLICT (teacher_id, provider)
     DO UPDATE SET status = 'pending', secrets_encrypted = NULL, oauth_state_hash = NULL,
                   oauth_state_expires_at = NULL, connected_at = NULL, updated_at = NOW()`,
    [teacher.teacher_id, teacher.school_id],
  );

  const provider: StoredOAuthProvider = new StoredOAuthProvider({}, redirectUri, (): Promise<void> =>
    saveSecrets(teacher, provider.secrets),
  );
  const outcome = await auth(provider, { serverUrl: getKeeperMcpEndpoint() });
  if (outcome === "AUTHORIZED") {
    await saveSecrets(teacher, provider.secrets);
    await markConnected(teacher);
    return { status: "connected" };
  }
  if (!provider.authorizationUrl || !provider.stateValue) {
    throw new CalendarConnectionError("authorization_failed", "Keeper did not provide a sign-in page.");
  }
  await saveSecrets(teacher, provider.secrets);
  await getPool().query(
    `UPDATE calendar_connections
        SET oauth_state_hash = $3, oauth_state_expires_at = NOW() + make_interval(mins => $4)
      WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
    [teacher.teacher_id, teacher.school_id, hashState(provider.stateValue), STATE_TTL_MINUTES],
  );
  return { status: "redirect", authorization_url: provider.authorizationUrl.toString() };
}

/**
 * Finish the connection when Keeper sends the teacher back. The `state` must match the one we
 * issued to THIS signed-in teacher, once, within a few minutes. Anything else is refused.
 */
export async function completeConnection(
  teacher: Who,
  redirectUri: string,
  code: string,
  state: string,
): Promise<void> {
  requireConfigured();
  const row = await loadRow(teacher);
  const expired = !row?.oauth_state_expires_at || row.oauth_state_expires_at.getTime() < Date.now();
  const stored = row?.oauth_state_hash ? Buffer.from(row.oauth_state_hash) : null;
  const supplied = Buffer.from(hashState(state));
  if (
    !row ||
    row.status !== "pending" ||
    expired ||
    !stored ||
    stored.length !== supplied.length ||
    !timingSafeEqual(stored, supplied)
  ) {
    throw new CalendarConnectionError("bad_state", "This calendar sign-in link is invalid or has expired.");
  }
  // One use only: clear the state before exchanging the code.
  await getPool().query(
    `UPDATE calendar_connections SET oauth_state_hash = NULL, oauth_state_expires_at = NULL
      WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
    [teacher.teacher_id, teacher.school_id],
  );

  const provider = new StoredOAuthProvider(readSecrets(row.secrets_encrypted), redirectUri);
  const outcome = await auth(provider, {
    serverUrl: getKeeperMcpEndpoint(),
    authorizationCode: code,
  });
  if (outcome !== "AUTHORIZED") {
    throw new CalendarConnectionError("authorization_failed", "Keeper did not authorize the connection.");
  }
  provider.secrets.code_verifier = undefined;
  await saveSecrets(teacher, provider.secrets);
  await markConnected(teacher);
}

export async function disconnect(teacher: Who): Promise<void> {
  await getPool().query(
    `UPDATE calendar_connections
        SET status = 'revoked', secrets_encrypted = NULL, oauth_state_hash = NULL,
            oauth_state_expires_at = NULL, updated_at = NOW()
      WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
    [teacher.teacher_id, teacher.school_id],
  );
}

/**
 * Prove the link works by making one read-only call to Keeper: how many events are in the
 * next 24 hours. Only the count comes back; event titles and details are never read or kept.
 */
export async function checkConnection(
  teacher: Who,
  redirectUri: string,
): Promise<{ tools_discovered: number; events_next_24h: number | null }> {
  requireConfigured();
  const row = await loadRow(teacher);
  if (!row || row.status !== "connected") {
    throw new CalendarConnectionError("not_connected", "No calendar is connected.");
  }
  const provider: StoredOAuthProvider = new StoredOAuthProvider(
    readSecrets(row.secrets_encrypted),
    redirectUri,
    (): Promise<void> => saveSecrets(teacher, provider.secrets),
  );
  const session = await connectMcpServer({ endpoint: getKeeperMcpEndpoint(), authProvider: provider });
  try {
    const tools = await session.listTools();
    const from = new Date();
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const result = await getKeeperEventCount(session, { from: from.toISOString(), to: to.toISOString() });
    await getPool().query(
      `UPDATE calendar_connections SET last_checked_at = NOW()
        WHERE teacher_id = $1 AND school_id = $2 AND provider = 'keeper'`,
      [teacher.teacher_id, teacher.school_id],
    );
    return { tools_discovered: tools.length, events_next_24h: readCount(result) };
  } finally {
    await session.close().catch(() => undefined);
  }
}

/** Pull a plain number out of an MCP tool result, or null if it is not a simple count. */
export function readCount(result: unknown): number | null {
  const content = (result as { content?: { type?: string; text?: string }[] })?.content;
  const text = content?.find((part) => part.type === "text")?.text;
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "number") return parsed;
    const count = (parsed as { count?: unknown })?.count;
    return typeof count === "number" ? count : null;
  } catch {
    const match = /\b(\d+)\b/.exec(text);
    return match ? Number(match[1]) : null;
  }
}
