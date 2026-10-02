export type ContainerFetch = (request: Request) => Promise<Response>;

const unavailablePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redlib is temporarily unavailable</title></head>
<body><main><h1>Redlib is temporarily unavailable</h1>
<p>Please try again in a moment.</p>
<p><a href="/">Try again</a></p></main></body></html>`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleRequest(
  request: Request,
  containerFetch: ContainerFetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/__health") {
    // This endpoint does not start the container or claim Reddit is reachable.
    return jsonResponse({ worker: "ok", service: "redlib" });
  }

  const isContainerHealth = url.pathname === "/__health/container";
  try {
    if (isContainerHealth) {
      const health = await containerFetch(
        new Request(new URL("/settings", url.origin), {
          method: "GET",
          headers: { "Accept-Encoding": "identity" },
          redirect: "manual",
        }),
      );
      await health.body?.cancel();
      return jsonResponse(
        { worker: "ok", redlib: health.ok ? "ok" : "error", status: health.status },
        health.ok ? 200 : 503,
      );
    }

    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", url.protocol.slice(0, -1));
    const upstream = await containerFetch(
      new Request(request, { headers, redirect: "manual" }),
    );

    // Return the body stream, status, cookies, CSP, and media headers untouched.
    // Do not follow redirects: settings POSTs use them to deliver cookies.
    const location = upstream.headers.get("Location");
    if (location && /^https?:\/\//i.test(location)) {
      const target = new URL(location);
      if (["container", "localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
        const response = new Response(upstream.body, upstream);
        response.headers.set("Location", url.origin + target.pathname + target.search + target.hash);
        return response;
      }
    }
    return upstream;
  } catch (error) {
    console.error("Redlib container request failed", error);
    if (isContainerHealth) {
      return jsonResponse({ worker: "ok", redlib: "unavailable" }, 503);
    }
    return new Response(request.method === "HEAD" ? null : unavailablePage, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "10",
      },
    });
  }
}
