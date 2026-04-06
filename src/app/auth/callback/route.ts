import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isValidRedirect(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("://") &&
    !path.includes("\\")
  );
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const redirectPath = isValidRedirect(next) ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${redirectPath}`);
    }

    console.error("Auth callback exchange failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_error`);
}
