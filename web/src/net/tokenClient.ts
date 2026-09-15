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
  const endpoint = `${base}/token`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, name }),
    });
  } catch (err) {
    // Almost always CORS or "server unreachable" — both look identical to
    // fetch (a generic TypeError with no useful message), so log the
    // endpoint we tried and point at the Network tab for the real reason.
    console.error(`[token] fetch(${endpoint}) failed (CORS? server down?):`, err);
    return { ok: false, reason: "error" };
  }

  if (res.status === 503) return { ok: false, reason: "unavailable" };
  if (!res.ok) {
    console.error(`[token] ${endpoint} -> HTTP ${res.status}:`, await res.text().catch(() => ""));
    return { ok: false, reason: "error" };
  }

  try {
    const data = (await res.json()) as { token: string; url: string; room: string };
    if (!data.token || !data.url) {
      console.error(`[token] ${endpoint} returned an incomplete response:`, data);
      return { ok: false, reason: "error" };
    }
    return { ok: true, token: data.token, url: data.url, room: data.room };
  } catch (err) {
    console.error(`[token] ${endpoint} response was not valid JSON:`, err);
    return { ok: false, reason: "error" };
  }
}
