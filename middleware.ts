import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/pricing", "/login", "/signup", "/verify"];

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

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
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // This is the one network round-trip to Supabase Auth per request —
  // required here to actually verify the session and refresh it if
  // expired. We forward the result below via headers so nested layouts
  // (which re-run on every navigation) don't have to call getUser()
  // again and pay a second round-trip for the same verification.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Set on requestHeaders (forwarded to Server Components) rather than
  // response.headers (which only reaches the browser). Always
  // overwritten here from the verified `user`, so this can't be spoofed
  // by a client sending its own x-user-id header — middleware runs
  // first and this value always wins.
  requestHeaders.set("x-user-id", user?.id ?? "");
  requestHeaders.set("x-user-email", user?.email ?? "");
  response = NextResponse.next({ request: { headers: requestHeaders } });

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p) || path.startsWith("/api/webhooks");

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (path === "/login" || path === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};