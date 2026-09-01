import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Supabase client bound to the current request's auth cookies. Respects RLS
 * (runs as the `authenticated` role) — use this for anything that should be
 * scoped to "am I signed in", such as auth actions (sign out) and the
 * middleware/callback session dance.
 *
 * Data access for the dashboard itself uses `serviceClient()` from
 * `@pulse/shared` (see lib/data/*) since this is a single-operator console
 * and RLS here is just the backstop against a leaked anon key.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component render, which can't set cookies.
            // Fine — middleware refreshes the session cookie on navigation.
          }
        },
      },
    }
  );
}
