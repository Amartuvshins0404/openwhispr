import { useState, useCallback, useEffect, useRef } from "react";
import { getCachedPlatform } from "../utils/platform";

export function useSystemAudioPermission() {
  const isMacOS = getCachedPlatform() === "darwin";
  const [granted, setGranted] = useState(!isMacOS);
  const [accessMode, setAccessMode] = useState<"native" | "legacy" | "unsupported">(
    isMacOS ? "legacy" : "unsupported"
  );
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (!isMacOS || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const result = await window.electronAPI?.checkSystemAudioAccess?.();
      setGranted(result?.granted ?? false);
      setAccessMode(result?.mode ?? "legacy");
    } finally {
      checkingRef.current = false;
    }
  }, [isMacOS]);

  // Check on mount
  useEffect(() => {
    check();
  }, [check]);

  // Re-check when the window regains focus (user may have just toggled it in System Settings)
  useEffect(() => {
    if (!isMacOS) return;
    const handleFocus = () => check();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isMacOS, check]);

  const openSettings = useCallback(async () => {
    await window.electronAPI?.openSystemAudioSettings?.();
  }, []);

  // Trigger the native macOS permission prompt via getDisplayMedia (used in onboarding)
  const request = useCallback(async (): Promise<boolean> => {
    if (!isMacOS) return true;
    if (accessMode === "native") {
      const result = await window.electronAPI?.requestSystemAudioAccess?.();
      const isGranted = result?.granted ?? false;
      setGranted(isGranted);
      setAccessMode(result?.mode ?? "native");
      return isGranted;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
      setGranted(true);
      return true;
    } catch {
      return false;
    }
  }, [accessMode, isMacOS]);

  return { granted, request, openSettings, check, isMacOS };
}
