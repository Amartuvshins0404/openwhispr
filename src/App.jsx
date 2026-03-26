import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { useToast } from "./components/ui/Toast";
import { useHotkey } from "./hooks/useHotkey";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useSettingsStore } from "./stores/settingsStore";

// Audio frequency visualizer — pill with animated bars driven by mic input
const AudioVisualizer = ({ barCount = 14 }) => {
  const [levels, setLevels] = useState(() => new Array(barCount).fill(0.15));
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        analyserRef.current = { ctx, analyser, stream };

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(dataArray);

          // Map frequency bins to bar levels (0-1)
          const step = Math.floor(dataArray.length / barCount);
          const newLevels = [];
          for (let i = 0; i < barCount; i++) {
            const idx = Math.min(i * step, dataArray.length - 1);
            // Normalize to 0-1, with a minimum so bars are always visible
            const raw = dataArray[idx] / 255;
            newLevels.push(Math.max(0.1, raw));
          }
          setLevels(newLevels);
          animFrameRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch {
        // Mic access failed — show idle animation
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (analyserRef.current) {
        analyserRef.current.stream.getTracks().forEach((t) => t.stop());
        analyserRef.current.ctx.close().catch(() => {});
        analyserRef.current = null;
      }
    };
  }, [barCount]);

  return (
    <div className="flex items-center justify-center gap-[3px] h-5">
      {levels.map((level, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-green-400"
          style={{
            height: `${Math.max(4, level * 20)}px`,
            transition: "height 80ms ease-out",
          }}
        />
      ))}
    </div>
  );
};

// Processing spinner — pulsing dots
const ProcessingIndicator = () => (
  <div className="flex items-center justify-center gap-1.5">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse"
        style={{ animationDelay: `${i * 150}ms` }}
      />
    ))}
  </div>
);

export default function App() {
  const { toast, dismiss, toastCount } = useToast();
  const { t } = useTranslation();
  useHotkey();

  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);
  const prevAutoHideRef = useRef(floatingIconAutoHide);

  const setWindowInteractivity = useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  // Toast-based notifications (hotkey fallback, accessibility, corrections)
  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const unsubscribeAccessibility = window.electronAPI?.onAccessibilityMissing?.(() => {
      toast({
        title: t("app.toasts.accessibilityMissing.title"),
        description: t("app.toasts.accessibilityMissing.description"),
        duration: 12000,
      });
    });

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (words && words.length > 0) {
        const wordList = words.map((w) => `\u201c${w}\u201d`).join(", ");
        let toastId;
        toastId = toast({
          title: t("app.toasts.addedToDict", { words: wordList }),
          variant: "success",
          duration: 6000,
          action: (
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.undoLearnedCorrections?.(words);
                  if (result?.success) {
                    dismiss(toastId);
                  }
                } catch {
                  // silently fail
                }
              }}
              className="text-[10px] font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-emerald-100/90 hover:text-white
                bg-emerald-500/15 hover:bg-emerald-500/25
                border border-emerald-400/20 hover:border-emerald-400/35
                transition-all duration-150"
            >
              {t("app.toasts.undo")}
            </button>
          ),
        });
      }
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeAccessibility?.();
      unsubscribeCorrections?.();
    };
  }, [toast, dismiss, t]);

  // Window interactivity for toasts
  useEffect(() => {
    if (toastCount > 0) {
      setWindowInteractivity(true);
    } else {
      setWindowInteractivity(false);
    }
  }, [toastCount, setWindowInteractivity]);

  // Window resizing for toasts
  useEffect(() => {
    if (toastCount > 0) {
      window.electronAPI?.resizeMainWindow?.("WITH_TOAST");
    } else {
      window.electronAPI?.resizeMainWindow?.("BASE");
    }
  }, [toastCount]);

  const handleDictationToggle = useCallback(() => {
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const { isRecording, isProcessing } = useAudioRecording(toast, {
    onToggle: handleDictationToggle,
  });

  // Sync auto-hide from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onFloatingIconAutoHideChanged?.((enabled) => {
      localStorage.setItem("floatingIconAutoHide", String(enabled));
      useSettingsStore.setState({ floatingIconAutoHide: enabled });
    });
    return () => unsubscribe?.();
  }, []);

  // Show pill only when recording or processing, hide otherwise
  const showPill = isRecording || isProcessing;

  useEffect(() => {
    if (showPill) {
      window.electronAPI?.showDictationPanel?.();
      window.electronAPI?.resizeMainWindow?.("BASE");
    } else {
      // Brief delay before hiding so the user sees the transition
      const hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, 200);
      return () => clearTimeout(hideTimeout);
    }
  }, [showPill]);

  // Auto-hide sync (when setting changes)
  useEffect(() => {
    if (!floatingIconAutoHide && prevAutoHideRef.current) {
      // Setting was just disabled — don't force-show, pill logic handles visibility
    }
    prevAutoHideRef.current = floatingIconAutoHide;
  }, [floatingIconAutoHide]);

  // Escape key handler
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        window.electronAPI?.hideWindow?.();
      }
    };
    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, []);

  if (!showPill) {
    return <div className="dictation-window" />;
  }

  return (
    <div className="dictation-window" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        className={`
          flex items-center justify-center
          px-5 py-2.5
          rounded-full
          bg-black/90 backdrop-blur-md
          border border-white/10
          shadow-[0_4px_24px_rgba(0,0,0,0.5)]
          transition-all duration-300 ease-out
        `}
        style={{
          minWidth: isProcessing ? "100px" : "160px",
        }}
      >
        {isRecording ? (
          <AudioVisualizer barCount={14} />
        ) : isProcessing ? (
          <ProcessingIndicator />
        ) : null}
      </div>
    </div>
  );
}
