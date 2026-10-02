import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRequest } from "../worker/proxy.ts";

test("search preserves the path, query, and settings cookie", async () => {
  const request = new Request("https://redlib.example/search?q=cats&sort=new", {
    headers: { Cookie: "theme=dark", "X-Forwarded-Proto": "http" },
  });
  const response = await handleRequest(request, async (forwarded) => {
    assert.equal(forwarded.url, request.url);
    assert.equal(forwarded.headers.get("Cookie"), "theme=dark");
    assert.equal(forwarded.headers.get("X-Forwarded-Proto"), "https");
    assert.equal(forwarded.headers.get("X-Forwarded-Host"), "redlib.example");
    assert.equal(forwarded.redirect, "manual");
    return new Response("Search results");
  });
  assert.equal(await response.text(), "Search results");
});

test("settings POST preserves the body, redirect, and separate cookies", async () => {
  const request = new Request("https://redlib.example/settings", {
    method: "POST",
    body: "theme=dark&layout=compact",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const response = await handleRequest(request, async (forwarded) => {
    assert.equal(forwarded.method, "POST");
    assert.equal(await forwarded.text(), "theme=dark&layout=compact");
    const headers = new Headers({ Location: "/settings" });
    headers.append("Set-Cookie", "theme=dark; Path=/; HttpOnly");
    headers.append("Set-Cookie", "layout=compact; Path=/; HttpOnly");
    return new Response(null, { status: 302, headers });
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/settings");
  assert.equal(response.headers.getSetCookie().length, 2);
});

test("media streaming and byte range headers survive the proxy", async () => {
  const request = new Request("https://redlib.example/vid/test/DASH_720.mp4", {
    headers: { Range: "bytes=0-3" },
  });
  let finish;
  const body = new ReadableStream({ start(controller) { finish = controller; } });
  const upstream = new Response(body, {
    status: 206,
    headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-3/100", "Accept-Ranges": "bytes" },
  });
  const response = await handleRequest(request, async (forwarded) => {
    assert.equal(forwarded.headers.get("Range"), "bytes=0-3");
    return upstream;
  });
  assert.equal(response, upstream);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-3/100");
  finish.enqueue(new Uint8Array([1, 2, 3, 4]));
  finish.close();
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test("internal redirects are rewritten without losing cookies", async () => {
  const response = await handleRequest(new Request("https://redlib.example/settings"), async () =>
    new Response(null, { status: 302, headers: { Location: "http://localhost:8080/settings?updated=1", "Set-Cookie": "theme=dark; Path=/" } }),
  );
  assert.equal(response.headers.get("Location"), "https://redlib.example/settings?updated=1");
  assert.equal(response.headers.getSetCookie().length, 1);
});

test("upstream failures retain their original status and response", async () => {
  const upstream = new Response("Reddit rate limit", { status: 429 });
  assert.equal(await handleRequest(new Request("https://redlib.example/"), async () => upstream), upstream);
});

test("Worker health never starts a container", async () => {
  const response = await handleRequest(new Request("https://redlib.example/__health"), async () => {
    assert.fail("Container must not be called");
  });
  assert.deepEqual(await response.json(), { worker: "ok", service: "redlib" });
});

test("container health checks settings without user cookies", async () => {
  const response = await handleRequest(new Request("https://redlib.example/__health/container", { headers: { Cookie: "theme=dark" } }), async (forwarded) => {
    assert.equal(new URL(forwarded.url).pathname, "/settings");
    assert.equal(forwarded.headers.get("Cookie"), null);
    return new Response("Settings");
  });
  assert.deepEqual(await response.json(), { worker: "ok", redlib: "ok", status: 200 });
});

test("a failed container health check does not report ready", async () => {
  const response = await handleRequest(new Request("https://redlib.example/__health/container"), async () => new Response("Failure", { status: 500 }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).redlib, "error");
});

test("unavailable containers return retryable errors without exposing internals", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const fail = async () => { throw new Error("Internal secret marker"); };
    const response = await handleRequest(new Request("https://redlib.example/"), fail);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "10");
    assert.equal((await response.text()).includes("Internal secret marker"), false);
    const head = await handleRequest(new Request("https://redlib.example/", { method: "HEAD" }), fail);
    assert.equal(head.body, null);
    const health = await handleRequest(new Request("https://redlib.example/__health/container"), fail);
    assert.equal(health.status, 503);
    assert.equal((await health.json()).redlib, "unavailable");
  } finally { console.error = originalError; }
});
