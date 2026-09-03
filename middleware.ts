import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/pricing", "/login", "/signup", "/verify"];

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  // Cookies Supabase wants set on the response (e.g. a refreshed
  // session token), collected here rather than applied immediately —
  // we don't know yet whether the final response will be a redirect
  // or a pass-through, and want to apply them to whichever one we
  // actually return, exactly once, at the end.
  let cookiesToApply: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToApply = cookiesToSet;
        },
      },
    }
  );

  // The one network round-trip to Supabase Auth per request — required
  // to verify the session and refresh it if expired. The verified
  // result is forwarded to nested layouts via requestHeaders below, so
  // they don't need to call getUser() again and pay a second
  // round-trip for the same verification.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Always overwritten here from the verified `user`, so this can't be
  // spoofed by a client sending its own x-user-id header.
  requestHeaders.set("x-user-id", user?.id ?? "");
  requestHeaders.set("x-user-email", user?.email ?? "");

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p) || path.startsWith("/api/webhooks");

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    const redirectResponse = NextResponse.redirect(loginUrl);
    cookiesToApply.forEach(({ name, value, options }) => redirectResponse.cookies.set(name, value, options));
    return redirectResponse;
  }

  if (user && (path === "/login" || path === "/signup")) {
    const redirectResponse = NextResponse.redirect(new URL("/dashboard", request.url));
    cookiesToApply.forEach(({ name, value, options }) => redirectResponse.cookies.set(name, value, options));
    return redirectResponse;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  cookiesToApply.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};