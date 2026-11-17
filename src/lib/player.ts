// One audio engine for both sources: an <audio> element for Apple previews and a
// hidden YouTube IFrame player. YouTube playback starts at a random point in the
// middle of the song (configurable %), never at 0:00.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PlayableSource } from "./types";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type PlayerState = {
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  source?: PlayableSource["kind"];
  position: number;
  duration: number;
  /** position when this snippet started (YouTube offset) */
  startedAt: number;
};

let ytApi: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytApi;
}

class Engine {
  private audio = new Audio();
  private yt: any = null;
  private ytReady: Promise<any> | null = null;
  private ytHost: HTMLElement | null = null;
  private timer: number | undefined;
  private token = 0;
  private listeners = new Set<() => void>();
  state: PlayerState = { status: "idle", position: 0, duration: 0, startedAt: 0 };
  volume = 0.8;
  startRange: [number, number] = [0.25, 0.45];

  constructor() {
    this.audio.preload = "auto";
    this.audio.addEventListener("playing", () => this.set({ status: "playing" }));
    this.audio.addEventListener("pause", () => this.state.source === "apple" && this.state.status !== "ended" && this.set({ status: "paused" }));
    this.audio.addEventListener("ended", () => this.set({ status: "ended" }));
    this.audio.addEventListener("error", () => this.state.source === "apple" && this.set({ status: "error" }));
    this.audio.addEventListener("timeupdate", () =>
      this.set({ position: this.audio.currentTime, duration: this.audio.duration || 30 }),
    );
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  attachYouTubeHost(el: HTMLElement | null) {
    this.ytHost = el;
  }

  private ensureYT(): Promise<any> {
    if (this.ytReady) return this.ytReady;
    this.ytReady = loadYouTubeApi().then(
      (YT) =>
        new Promise((resolve) => {
          const mount = document.createElement("div");
          (this.ytHost ?? document.body).appendChild(mount);
          this.yt = new YT.Player(mount, {
            width: 200,
            height: 200,
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3 },
            events: {
              onReady: () => resolve(this.yt),
              onStateChange: (e: any) => {
                if (this.state.source !== "youtube") return;
                if (e.data === YT.PlayerState.PLAYING) this.set({ status: "playing" });
                else if (e.data === YT.PlayerState.PAUSED) this.set({ status: "paused" });
                else if (e.data === YT.PlayerState.ENDED) this.set({ status: "ended" });
                else if (e.data === YT.PlayerState.BUFFERING) this.set({ status: "loading" });
              },
              onError: (e: any) => {
                if (import.meta.env.DEV) console.info("[youtube] error", e?.data);
                if (this.state.source === "youtube") this.set({ status: "error" });
              },
            },
          });
        }),
    );
    return this.ytReady;
  }

  /** Preload the YouTube API so the first card starts quickly. */
  warmUp() {
    void this.ensureYT();
  }

  async play(source: PlayableSource) {
    const token = ++this.token;
    this.stopAll();
    this.set({ status: "loading", source: source.kind, position: 0, duration: 0, startedAt: 0 });
    if (source.kind === "apple") {
      this.audio.src = source.previewUrl;
      this.audio.volume = this.volume;
      try {
        await this.audio.play();
      } catch {
        if (token === this.token) this.set({ status: "paused" }); // autoplay blocked: user presses play
      }
      return;
    }
    const yt = await this.ensureYT();
    if (token !== this.token) return;
    const [lo, hi] = this.startRange;
    const pct = lo + Math.random() * Math.max(0, hi - lo);
    if (source.durationSec && source.durationSec > 20) {
      const start = Math.floor(source.durationSec * pct);
      yt.loadVideoById({ videoId: source.videoId, startSeconds: start });
      this.set({ startedAt: start, duration: source.durationSec });
    } else {
      // Unknown duration: start, read the duration, then jump in.
      yt.loadVideoById({ videoId: source.videoId });
      const jump = () => {
        if (token !== this.token) return;
        const d = yt.getDuration?.() ?? 0;
        if (d > 20) {
          const start = Math.floor(d * pct);
          yt.seekTo(start, true);
          this.set({ startedAt: start, duration: d });
        } else setTimeout(jump, 250);
      };
      setTimeout(jump, 300);
    }
    yt.setVolume(Math.round(this.volume * 100));
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (this.state.source !== "youtube") return;
      this.set({ position: yt.getCurrentTime?.() ?? 0, duration: yt.getDuration?.() || this.state.duration });
    }, 250);
  }

  toggle() {
    if (this.state.source === "apple") {
      if (this.audio.paused) void this.audio.play();
      else this.audio.pause();
    } else if (this.state.source === "youtube" && this.yt) {
      if (this.state.status === "playing") this.yt.pauseVideo();
      else this.yt.playVideo();
    }
  }

  setVolume(v: number) {
    this.volume = v;
    this.audio.volume = v;
    this.yt?.setVolume?.(Math.round(v * 100));
  }

  private stopAll() {
    window.clearInterval(this.timer);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.yt?.stopVideo?.();
  }

  stop() {
    this.token++;
    this.stopAll();
    this.set({ status: "idle", source: undefined, position: 0, duration: 0, startedAt: 0 });
  }
}

export const engine = new Engine();

export function usePlayer() {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

/** Mount point for the (visually hidden) YouTube iframe. */
export function useYouTubeHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    engine.attachYouTubeHost(ref.current);
    engine.warmUp();
    // The YouTube player focuses itself from inside its iframe, which would swallow
    // keystrokes meant for the guess fields. Hand focus back whenever that happens.
    let lastFocused: HTMLElement | null = null;
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && !ref.current?.contains(e.target)) lastFocused = e.target;
    };
    const onBlur = () =>
      setTimeout(() => {
        const active = document.activeElement;
        if (active && ref.current?.contains(active)) {
          if (lastFocused?.isConnected) lastFocused.focus();
          else (active as HTMLElement).blur();
        }
      }, 0);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return ref;
}

export function useElapsed(running: boolean, resetKey: unknown) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => setElapsed(0), [resetKey]);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now() - elapsed * 1000;
    const id = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, resetKey]);
  return elapsed;
}
