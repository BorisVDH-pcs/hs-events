// The `intake` Edge Function: the one door a plugin talks to (plan, 4.1).
//
// All of its logic is in handle.mjs and dink.mjs, which are tested offline.
// This shell -- reading the request, supabase-js for the database and Storage
// -- is tested on the local stack by server/test/stack.test.mjs (Supabase's
// edge runtime 1.77.8, Deno 2). It has not been deployed to a hosted project.
//
// Deploy without JWT verification (Dink sends no Authorization header):
//   supabase functions deploy intake --no-verify-jwt
//
// A player's Dink webhook URL is
//   https://<project>.supabase.co/functions/v1/intake/dink?t=hse_...

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleDink } from './handle.mjs';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const deps = {
  async rpc(fn: string, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(fn, args);
    // handle.mjs tells a rule's refusal (P0001) from an outage by this code.
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  },
  async upload(path: string, bytes: Uint8Array, type: string) {
    const { error } = await supabase.storage.from('evidence').upload(path, bytes, { contentType: type });
    if (error) throw new Error(error.message);
  },
  async remove(path: string) {
    await supabase.storage.from('evidence').remove([path]);
  },
};

// One answer for every request that was understood, whatever it matched: the
// reply must not tell a drop for a locked tile from a drop nobody wants.
const done = (status: number) =>
  new Response(status === 200 ? '{"ok":true}' : '{"ok":false}', {
    status,
    headers: { 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== 'POST' || !url.pathname.endsWith('/dink')) return done(404);

  let payloadText = '';
  let image: { bytes: Uint8Array; type: string } | null = null;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      payloadText = String(form.get('payload_json') ?? '');
      const file = form.get('file');
      if (file instanceof File) {
        image = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
      }
    } else {
      payloadText = await req.text();
    }
  } catch {
    return done(400);
  }

  try {
    const result = await handleDink({ token: url.searchParams.get('t'), payloadText, image }, deps);
    // The log gets the outcome. Never the token, never the request URL.
    console.log(JSON.stringify({ outcome: result.outcome, reason: result.reason, results: result.results, resized: result.resized }));
    return done(result.status);
  } catch (e) {
    console.error('intake failed:', (e as Error).message);
    return done(500); // Dink will retry
  }
});
