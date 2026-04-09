import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

const PUBLIC_ROUTES = ["/sign-in", "/sign-up", "/auth/callback", "/pending-approval"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Check public routes BEFORE any Supabase call
  const isPublic = isPublicRoute(pathname);

  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // Refresh session — uses getUser() (NOT getSession()) for security
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      return NextResponse.redirect(url);
    }

    // Pending role enforcement — redirect pending users away from protected routes
    if (user) {
      const role = (user.app_metadata?.user_role as string | undefined) ?? "pending";
      const isPending = role === "pending";
      const onPendingPage = pathname === "/pending-approval";

      if (isPending && !onPendingPage && !isPublic) {
        const url = request.nextUrl.clone();
        url.pathname = "/pending-approval";
        return NextResponse.redirect(url);
      }

      if (!isPending && onPendingPage) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }
    }

    if (user && isPublic && pathname !== "/auth/callback" && pathname !== "/pending-approval") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (error) {
    console.error("Middleware auth error:", error);

    // On Supabase outage: allow public routes through, redirect protected to sign-in
    if (isPublic) {
      return NextResponse.next({ request });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("error", "service_unavailable");
    return NextResponse.redirect(url);
  }
}
