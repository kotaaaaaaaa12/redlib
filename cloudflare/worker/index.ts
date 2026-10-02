import { Container, getContainer } from "@cloudflare/containers";
import { handleRequest } from "./proxy.ts";

export interface Env {
  REDLIB: DurableObjectNamespace<RedlibContainer>;
  [key: string]: unknown;
}

export class RedlibContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  enableInternet = true;
  envVars: Record<string, string>;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    // Worker variables do not enter the container unless explicitly forwarded.
    this.envVars = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith("REDLIB_") && typeof entry[1] === "string",
      ),
    );
  }

  override onStart(): void {
    console.log("Redlib container started");
  }

  override onStop(params: { exitCode: number; reason: string }): void {
    console.log("Redlib container stopped", params);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, async (forwardedRequest) => {
      // A fixed name shares one token pool and keeps the instance count bounded.
      const container = getContainer(env.REDLIB, "redlib-main");
      await container.startAndWaitForPorts({
        ports: [8080],
        cancellationOptions: {
          instanceGetTimeoutMS: 30_000,
          portReadyTimeoutMS: 60_000,
        },
      });
      return container.fetch(forwardedRequest);
    });
  },
} satisfies ExportedHandler<Env>;
