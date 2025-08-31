// run_server.ts

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

console.log("🚀 Server running on http://0.0.0.0:8000");

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname === "/run") {
    const { script, feedUrl, sourceFeedId } = await req.json();

    const p = new Deno.Command("/snap/bin/deno", {
      args: [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        script,
        feedUrl,
      ],
      env: {
        SUPABASE_URL: "https://wvfwicbmtzxafekcsexw.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2ZndpY2JtdHp4YWZla2NzZXh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjEwNDU0MCwiZXhwIjoyMDYxNjgwNTQwfQ.3zNEPKz0p-cjzHWAeoH5kk6nz9nQPNEdaAmPC6WAYDY",
        SOURCE_FEED_ID: sourceFeedId,
      },
      stdout: "piped",
      stderr: "piped",
    });

    const process = p.spawn();
    const { code } = await process.status;
    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();

    return new Response(
      JSON.stringify({ code, stdout, stderr }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response("Not found", { status: 404 });
});
