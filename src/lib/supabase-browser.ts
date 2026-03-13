"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: ReturnType<typeof createClient> | null = null;

function getSupabase() {
	if (!url || !anonKey) return null;
	if (!client) client = createClient(url, anonKey, { auth: { persistSession: true, storage: typeof window !== "undefined" ? window.localStorage : undefined } });
	return client;
}

export async function getAccessToken(): Promise<string | null> {
	const supabase = getSupabase();
	if (!supabase) return null;
	const { data } = await supabase.auth.getSession();
	return data.session?.access_token ?? null;
}
