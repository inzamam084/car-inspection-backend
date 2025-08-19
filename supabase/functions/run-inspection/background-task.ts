/**
 * Utility for handling background tasks in Supabase Edge Functions
 */

export function runInBackground(task: () => Promise<void>): void {
  const backgroundTask = async () => {
    try {
      await task();
    } catch (error) {
      console.error("Background task failed:", error);
    }
  };

  // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(backgroundTask());
  } else {
    // Fallback for local development
    backgroundTask().catch((err) => console.error(err));
  }
}
