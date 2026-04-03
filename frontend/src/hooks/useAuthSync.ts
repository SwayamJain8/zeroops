"use client";

import { useEffect, useRef } from "react";
import { useSession } from "./useSession";
import { api } from "@/lib/api";

export function useAuthSync() {
  const { session } = useSession();
  const synced = useRef(false);

  useEffect(() => {
    if (!session?.access_token || synced.current) return;

    const user = session.user;
    const meta = user.user_metadata;

    api("/api/auth/sync", {
      method: "POST",
      token: session.access_token,
      body: JSON.stringify({
        github_id: meta?.user_name || meta?.preferred_username,
        avatar_url: meta?.avatar_url,
        github_access_token: session.provider_token || null,
      }),
    })
      .then(() => {
        synced.current = true;
      })
      .catch((err) => {
        console.error("Auth sync failed:", err);
      });
  }, [session]);
}
