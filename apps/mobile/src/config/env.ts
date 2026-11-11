/**
 * Global environment configuration for the mobile client.
 * In production builds, these can be set via process.env or EAS secrets.
 */
export const ENV = {
  // Hosted Supabase connection credentials
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || "https://your-project.supabase.co",
  SUPABASE_ANON_KEY:
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsIn...",

  // Your VPS domain where Next.js web app is running (for /api/messages & tool approvals)
  WEB_API_URL: process.env.EXPO_PUBLIC_WEB_API_URL || "https://sayabot.sayalabs.in",

  // Default app metadata
  APP_NAME: "Sayabot",
  DEFAULT_ORG_SLUG: "default",
}
