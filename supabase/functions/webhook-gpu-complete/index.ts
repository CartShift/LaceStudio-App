// Supabase Edge Function placeholder for production webhook handling.
// Runtime: Deno.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async () => {
  return new Response(
    JSON.stringify({ ok: true, message: "Use Next.js /api/webhooks/gpu-complete for primary webhook handling." }),
    { headers: { "Content-Type": "application/json" } },
  );
});
