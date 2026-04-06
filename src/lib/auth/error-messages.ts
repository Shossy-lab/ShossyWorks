import type { AuthError } from "@supabase/supabase-js";

export function getAuthErrorMessage(error: AuthError): string {
  // Map known Supabase error messages to user-friendly text
  // DO NOT expose internal error messages to users
  const messageMap: Record<string, string> = {
    "Invalid login credentials": "Invalid email or password.",
    "Email not confirmed": "Please check your email to verify your account.",
    "User already registered": "An account with this email already exists.",
    "Password should be at least 6 characters":
      "Password must be at least 6 characters.",
    "Email rate limit exceeded": "Too many attempts. Please try again later.",
    "For security purposes, you can only request this after":
      "Please wait before trying again.",
  };

  // Check for partial matches
  for (const [key, value] of Object.entries(messageMap)) {
    if (error.message.includes(key)) {
      return value;
    }
  }

  // Generic fallback — never expose raw Supabase errors
  return "Something went wrong. Please try again.";
}
