// Fetches a LiveKit join token from the realtime server's POST /token
// (realtime/internal/livekit). Kept separate from socket.ts since this is a
// plain fetch, not part of the WebSocket protocol.

export type TokenResult =
  | { ok: true; token: string; url: string; room: string }
  | { ok: false; reason: "unavailable" | "error" };

/** ws(s)://host:port/ws -> http(s)://host:port (the realtime server's HTTP origin). */
function httpOriginFromWsUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/ws\/?$/, "");
}

/**
 * identity should be the id the realtime WebSocket already assigned this
 * tab (from the "welcome" message) so the LiveKit participant can be
 * correlated back to its avatar.
 */
export async function fetchLiveKitToken(
  wsUrl: string,
  identity: string,
  name: string,
): Promise<TokenResult> {
  const base = httpOriginFromWsUrl(wsUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, name }),
    });
  } catch {
    return { ok: false, reason: "error" };
  }

  if (res.status === 404) return { ok: false, reason: "unavailable" };
  if (!res.ok) return { ok: false, reason: "error" };

  try {
    const data = (await res.json()) as { token: string; url: string; room: string };
    if (!data.token || !data.url) return { ok: false, reason: "error" };
    return { ok: true, token: data.token, url: data.url, room: data.room };
  } catch {
    return { ok: false, reason: "error" };
  }
}
