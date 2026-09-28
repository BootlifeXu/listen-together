import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useRoute } from "wouter";
import QRCode from "qrcode";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  ExternalLink,
  FileAudio,
  Headphones,
  Link as LinkIcon,
  Loader2,
  Pause,
  Play,
  Radio,
  Search,
  Share2,
  SkipBack,
  SkipForward,
  Users,
  Upload,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  DemoTrack,
  RoomCommand,
  RoomServerMessage,
  RoomSnapshot,
} from "@shared/rooms";

type Session = { roomId: string; userId: string; role: "host" | "listener" };

type ApiResult<T> = T & { error?: string };

const SESSION_PREFIX = "listen-together-session:";

function getSession(roomId: string): Session | null {
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}${roomId}`);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session) {
  localStorage.setItem(`${SESSION_PREFIX}${session.roomId}`, JSON.stringify(session));
}

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as ApiResult<T>;
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function formatTime(value: number) {
  const safe = Math.max(0, Math.floor(value || 0));
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function makeInitialName() {
  try {
    return localStorage.getItem("listen-together-name") ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem("listen-together-name", name.trim());
  } catch {
    // Storage is an enhancement, not a requirement.
  }
}

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Header({ compact = false }: { compact?: boolean }) {
  const [, navigate] = useLocation();
  return (
    <header className={`site-header ${compact ? "site-header-compact" : ""}`}>
      <button className="brand" onClick={() => navigate("/")} aria-label="Listen Together home">
        <Mark />
        <span>listen together</span>
      </button>
      <div className="header-meta">
        <span className="eyebrow-dot" />
        <span>sync, not redistribution</span>
      </div>
    </header>
  );
}

function Landing() {
  const [, navigate] = useLocation();
  const [name, setName] = useState(makeInitialName);
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const createRoom = async () => {
    setBusy("create");
    setError("");
    try {
      const result = await api<{ roomId: string; userId: string }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const session = { roomId: result.roomId, userId: result.userId, role: "host" as const };
      saveSession(session);
      saveName(name);
      navigate(`/room/${result.roomId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create a room");
    } finally {
      setBusy(null);
    }
  };

  const joinRoom = async () => {
    const normalizedCode = roomCode.trim().toUpperCase();
    if (!normalizedCode) {
      setError("Enter a room code first.");
      return;
    }
    setBusy("join");
    setError("");
    try {
      const result = await api<{ roomId: string; userId: string }>(
        `/api/rooms/${normalizedCode}/join`,
        { method: "POST", body: JSON.stringify({ name }) }
      );
      const session = { roomId: result.roomId, userId: result.userId, role: "listener" as const };
      saveSession(session);
      saveName(name);
      navigate(`/room/${result.roomId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to join the room");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app-shell landing-shell">
      <Header />
      <main className="landing-main">
        <section className="hero-copy">
          <p className="section-label"><Radio size={14} /> realtime listening rooms</p>
          <h1>Be in the<br /><em>same moment.</em></h1>
          <p className="hero-description">
            A quiet, fast room for listening together. The app shares playback state and exact timestamps — each browser gets audio from a source its user is allowed to access.
          </p>
          <div className="hero-points">
            <span><Check size={14} /> host-led timing</span>
            <span><Check size={14} /> reconnects cleanly</span>
            <span><Check size={14} /> no audio relay</span>
          </div>
        </section>

        <section className="entry-panel" aria-label="Create or join a listening room">
          <div className="panel-rule" />
          <div className="field-block">
            <label htmlFor="name">your name <span>optional</span></label>
            <input
              id="name"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. alex"
              maxLength={24}
            />
          </div>
          <Button className="primary-action" onClick={createRoom} disabled={busy !== null}>
            {busy === "create" ? <Loader2 className="spin" size={16} /> : <Headphones size={16} />}
            create a room
            <ArrowRight size={16} />
          </Button>
          <div className="or-divider"><span>or join a room</span></div>
          <div className="join-row">
            <input
              aria-label="Room code"
              value={roomCode}
              onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              onKeyDown={event => event.key === "Enter" && void joinRoom()}
              placeholder="ROOM CODE"
              maxLength={6}
              className="room-code-input"
            />
            <Button variant="outline" className="join-action" onClick={joinRoom} disabled={busy !== null}>
              {busy === "join" ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
              join
            </Button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="entry-note">No account needed for this demo. Rooms are temporary and expire after 12 hours of inactivity.</p>
        </section>
      </main>
      <footer className="landing-footer">
        <span>built for the shared moment</span>
        <span>v0.1 / demo source</span>
      </footer>
    </div>
  );
}

function getPosition(snapshot: RoomSnapshot, now: number, clockOffset: number) {
  if (snapshot.playbackState !== "playing") return snapshot.playbackPosition;
  const serverNow = now + clockOffset;
  return Math.min(snapshot.duration, snapshot.playbackPosition + Math.max(0, serverNow - snapshot.lastUpdated) / 1000);
}

function SearchPanel({ queue, onSelect, onClose }: { queue: DemoTrack[]; onSelect: (track: DemoTrack) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DemoTrack[]>(queue);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api<{ results: DemoTrack[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        setResults(response.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="search-panel">
      <div className="search-heading">
        <div><p className="section-label">supported source</p><h3>Search the demo catalog</h3></div>
        <button className="icon-button" onClick={onClose} aria-label="Close search"><X size={17} /></button>
      </div>
      <div className="search-input-wrap">
        <Search size={16} />
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="try “Night Drive”" />
        {loading && <Loader2 className="spin" size={15} />}
      </div>
      <div className="search-results">
        {results.map(track => (
          <button key={track.id} className="search-result" onClick={() => onSelect(track)}>
            <span className="track-swatch" style={{ backgroundColor: track.color }} />
            <span className="result-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
            <span className="result-duration">{formatTime(track.duration)}</span>
            <ChevronRight size={15} />
          </button>
        ))}
        {!loading && results.length === 0 && <p className="empty-search">No demo tracks match that search.</p>}
      </div>
      <p className="search-footnote">Search is intentionally limited to the source this prototype can legally play in-browser.</p>
    </div>
  );
}

function RoomPage() {
  const [, params] = useRoute("/room/:roomId");
  const [, navigate] = useLocation();
  const roomId = (params?.roomId ?? "").toUpperCase();
  const [session, setSession] = useState<Session | null>(() => getSession(roomId));
  const [joinName, setJoinName] = useState(makeInitialName);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [visualPosition, setVisualPosition] = useState(0);
  const [connected, setConnected] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [localFileName, setLocalFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const clockOffsetRef = useRef(0);
  const localAudioRef = useRef<{ url: string; name: string; duration: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const shareLink = useMemo(() => `${window.location.origin}/room/${roomId}`, [roomId]);

  useEffect(() => () => {
    if (localAudioRef.current) URL.revokeObjectURL(localAudioRef.current.url);
  }, []);

  const sendCommand = useCallback((command: RoomCommand) => {
    if (session?.role !== "host") {
      setError("Only the host can change shared playback.");
      return;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("The room is reconnecting. Try that action again in a moment.");
      return;
    }
    socket.send(JSON.stringify({ command }));
  }, [session]);

  const syncAudio = useCallback((nextSnapshot: RoomSnapshot, nextOffset: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nextSnapshot.currentTrack.sourceKind === "local" && !localAudioRef.current) {
      setAudioBlocked(true);
      return;
    }
    const source = nextSnapshot.currentTrack.sourceKind === "local"
      ? localAudioRef.current?.url ?? ""
      : nextSnapshot.currentTrack.audioUrl;
    if (!source) {
      setAudioBlocked(true);
      return;
    }
    // Do this synchronously too: after a host clicks Play, the socket snapshot
    // can arrive before React runs the track effect. Returning here would lose
    // the user activation required by browser autoplay policies.
    if (audio.dataset.trackId !== nextSnapshot.currentTrack.id || audio.getAttribute("src") !== source) {
      audio.dataset.trackId = nextSnapshot.currentTrack.id;
      if (audio.getAttribute("src") !== source) {
        audio.src = source;
        audio.load();
      }
    }
    const target = getPosition(nextSnapshot, Date.now(), nextOffset);
    if (Math.abs(audio.currentTime - target) > 0.8 || Number.isNaN(audio.currentTime)) {
      audio.currentTime = target;
    }
    if (nextSnapshot.playbackState === "playing") {
      audio.play().then(() => {
        setAudioEnabled(true);
        setAudioBlocked(false);
      }).catch(() => setAudioBlocked(true));
    } else {
      audio.pause();
    }
  }, []);

  const enableListenerAudio = async () => {
    const audio = audioRef.current;
    if (!audio || !snapshot) return;
    try {
      const source = snapshot.currentTrack.sourceKind === "local"
        ? localAudioRef.current?.url
        : snapshot.currentTrack.audioUrl;
      if (!source) {
        setError("Choose the matching local file in this browser before enabling audio.");
        return;
      }
      if (audio.getAttribute("src") !== source) {
        audio.src = source;
        audio.load();
      }
      if (audio.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          const onReady = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("Audio could not be loaded")); };
          const cleanup = () => {
            audio.removeEventListener("loadedmetadata", onReady);
            audio.removeEventListener("error", onError);
          };
          audio.addEventListener("loadedmetadata", onReady, { once: true });
          audio.addEventListener("error", onError, { once: true });
        });
      }
      audio.muted = false;
      if (snapshot.playbackState === "playing") {
        await audio.play();
      } else {
        // Prime the browser's media permission while the user gesture is active,
        // without changing the room's paused state.
        await audio.play();
        audio.pause();
        audio.currentTime = getPosition(snapshot, Date.now(), clockOffsetRef.current);
      }
      setAudioEnabled(true);
      setAudioBlocked(false);
      setError("");
    } catch (cause) {
      setAudioBlocked(true);
      const errorName = cause instanceof DOMException ? cause.name : "";
      setError(errorName === "NotAllowedError"
        ? "Your browser blocked audio. Use the browser’s site sound permission, then tap enable again."
        : errorName === "NotSupportedError"
          ? "This browser does not support that audio format. Try an MP3, WAV, or OGG file."
          : "The shared audio could not be loaded. Check the file format, storage connection, or upload the file again.");
    }
  };

  const chooseLocalFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      if (!duration) {
        URL.revokeObjectURL(url);
        setError("This file does not expose readable audio metadata.");
        return;
      }
      if (localAudioRef.current) URL.revokeObjectURL(localAudioRef.current.url);
      localAudioRef.current = { url, name: file.name, duration };
      setLocalFileName(file.name);
      setAudioBlocked(false);
      if (session?.role === "host") {
        sendCommand({
          type: "selectLocalTrack",
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Local file",
          duration,
          color: "#1e1d1b",
        });
      }
      // Keep the probe alive after metadata has loaded. Clearing src here can
      // emit a late error event in some browsers and falsely report failure.
      probe.onerror = null;
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That file could not be read by this browser.");
    };
  };

  const shareFileWithRoom = (file: File | undefined) => {
    if (!file || !session || session.role !== "host") return;
    const probe = new Audio();
    const objectUrl = URL.createObjectURL(file);
    probe.preload = "metadata";
    probe.src = objectUrl;
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      URL.revokeObjectURL(objectUrl);
      if (!duration) {
        setError("This file does not expose readable audio metadata.");
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          setUploading(true);
          setError("");
          await api(`/api/rooms/${roomId}/upload`, {
            method: "POST",
            body: JSON.stringify({ userId: session.userId, fileName: file.name, mimeType: file.type || "audio/mpeg", duration, data: reader.result }),
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to share this audio file");
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => setError("The browser could not read this audio file.");
      reader.readAsDataURL(file);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError("That file could not be read by this browser.");
    };
  };

  useEffect(() => {
    if (!showQr) return;
    QRCode.toDataURL(shareLink, {
      width: 240,
      margin: 1,
      color: { dark: "#1e1d1b", light: "#f7f5ef" },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [shareLink, showQr]);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    const connect = async () => {
      try {
        const initial = await api<RoomSnapshot>(`/api/rooms/${roomId}`);
        if (disposed) return;
        setSnapshot(initial);
        setVisualPosition(getPosition(initial, Date.now(), 0));
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/ws?roomId=${roomId}&userId=${session.userId}`);
        socketRef.current = socket;
        socket.onopen = () => {
          setConnected(true);
          setError("");
          socket?.send(JSON.stringify({ kind: "ping", clientSentAt: Date.now() }));
        };
        socket.onmessage = event => {
          const message = JSON.parse(event.data) as RoomServerMessage;
          if (message.type === "pong") {
            if (message.clientSentAt) {
              const offset = message.serverNow - (message.clientSentAt + Date.now()) / 2;
              clockOffsetRef.current = offset;
              setClockOffset(offset);
            }
            return;
          }
          if (message.type === "error") {
            setError(message.message);
            return;
          }
          if (message.type === "snapshot") {
            setSnapshot(message.snapshot);
            const nextPosition = getPosition(message.snapshot, Date.now(), clockOffsetRef.current);
            setVisualPosition(nextPosition);
            syncAudio(message.snapshot, clockOffsetRef.current);
          }
        };
        socket.onclose = () => {
          setConnected(false);
          if (!disposed) setError("Connection lost. Reconnecting…");
        };
        socket.onerror = () => setConnected(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to open this room");
      }
    };
    void connect();
    const reconnect = window.setInterval(() => {
      if (!disposed && (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED)) void connect();
    }, 2500);
    return () => {
      disposed = true;
      window.clearInterval(reconnect);
      socket?.close();
      socketRef.current = null;
    };
  }, [roomId, session, syncAudio]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!snapshot) return;
      const position = getPosition(snapshot, Date.now(), clockOffset);
      setVisualPosition(position);
      const audio = audioRef.current;
      if (audio && snapshot.playbackState === "playing" && Math.abs(audio.currentTime - position) > 1.2) {
        audio.currentTime = position;
      }
      if (audio && snapshot.playbackState === "playing" && audio.paused) {
        audio.play().catch(() => setAudioBlocked(true));
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [snapshot, clockOffset]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !snapshot) return;
    const isLocal = snapshot.currentTrack.sourceKind === "local";
    const nextSource = isLocal ? localAudioRef.current?.url ?? "" : snapshot.currentTrack.audioUrl;
    if (audio.dataset.trackId !== snapshot.currentTrack.id || (nextSource && audio.getAttribute("src") !== nextSource)) {
      const onMetadata = () => syncAudio(snapshot, clockOffsetRef.current);
      audio.dataset.trackId = snapshot.currentTrack.id;
      setAudioEnabled(false);
      if (nextSource) audio.src = nextSource;
      else audio.removeAttribute("src");
      audio.addEventListener("loadedmetadata", onMetadata, { once: true });
      if (nextSource) audio.load();
      else setAudioBlocked(true);
      return () => audio.removeEventListener("loadedmetadata", onMetadata);
    }
    syncAudio(snapshot, clockOffsetRef.current);
  }, [snapshot?.currentTrack.id, snapshot?.currentTrack.audioUrl, snapshot?.currentTrack.sourceKind, localFileName, syncAudio]);

  const joinFromRoom = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ roomId: string; userId: string }>(`/api/rooms/${roomId}/join`, {
        method: "POST",
        body: JSON.stringify({ name: joinName }),
      });
      const nextSession = { roomId: result.roomId, userId: result.userId, role: "listener" as const };
      saveSession(nextSession);
      saveName(joinName);
      setSession(nextSession);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to join this room");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard?.writeText(shareLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const endRoom = async () => {
    if (!session || session.role !== "host") return;
    try {
      await api(`/api/rooms/${roomId}`, { method: "DELETE", body: JSON.stringify({ userId: session.userId }) });
      localStorage.removeItem(`${SESSION_PREFIX}${roomId}`);
      navigate("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to end this room");
    }
  };

  if (!session) {
    return (
      <div className="app-shell room-entry-shell">
        <Header compact />
        <main className="room-entry">
          <button className="back-link" onClick={() => navigate("/")}><ArrowLeft size={15} /> back home</button>
          <p className="section-label"><LinkIcon size={14} /> you have been invited</p>
          <h1>Join room<br /><em>{roomId}</em></h1>
          <p className="room-entry-copy">Enter a name to join the shared playback room. Your browser will load audio from the room’s supported source.</p>
          <div className="entry-panel join-entry-panel">
            <div className="field-block"><label htmlFor="join-name">your name</label><input id="join-name" autoFocus value={joinName} onChange={event => setJoinName(event.target.value)} placeholder="e.g. sam" maxLength={24} onKeyDown={event => event.key === "Enter" && void joinFromRoom()} /></div>
            <Button className="primary-action" onClick={joinFromRoom} disabled={loading}>{loading ? <Loader2 className="spin" size={16} /> : <Users size={16} />} join listening room <ArrowRight size={16} /></Button>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  const currentTrack = snapshot?.currentTrack;
  const isHost = session.role === "host";
  const duration = snapshot?.duration ?? currentTrack?.duration ?? 0;
  const progress = duration ? Math.min(100, (visualPosition / duration) * 100) : 0;
  const onlineUsers = snapshot?.connectedUsers.filter(user => user.online).length ?? 0;
  const isPlaying = snapshot?.playbackState === "playing";

  return (
    <div className="app-shell room-shell">
      <Header compact />
      <main className="room-main">
        <div className="room-topline">
          <button className="back-link" onClick={() => navigate("/")}><ArrowLeft size={15} /> leave room</button>
          <div className={`connection-state ${connected ? "is-connected" : ""}`}><span className="status-dot" />{connected ? "connected" : "reconnecting"}</div>
        </div>
        {error && <div className="room-notice" role="status"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss notice"><X size={15} /></button></div>}

        <div className="room-layout">
          <section className="now-playing-column">
            <div className="room-identity"><span className="section-label">room</span><strong>{roomId}</strong><span className="role-chip">{session.role === "host" ? "host" : "listener"}</span></div>
            <div className="album-art" style={{ backgroundColor: currentTrack?.color ?? "#f06a3a" }}>
              <div className="album-art-grid" />
              <span className="album-art-label">LT / {roomId}</span>
              <Headphones size={84} strokeWidth={1.1} />
              <span className="album-art-source">{currentTrack?.sourceLabel ?? "public demo audio"}</span>
            </div>
            <div className="track-header">
              <div><p className="section-label">now playing</p><h1>{currentTrack?.title ?? "Waiting for a track"}</h1><p className="track-artist">{currentTrack?.artist ?? "—"}</p></div>
              <span className={`play-state ${isPlaying ? "playing" : ""}`}><span />{isPlaying ? "playing" : "paused"}</span>
            </div>
            <div className="progress-block">
              <input aria-label="Playback position" className="range-input" type="range" min={0} max={duration || 1} step={0.1} value={Math.min(visualPosition, duration || 1)} disabled={!isHost} style={{ "--progress": `${progress}%` } as CSSProperties} onChange={event => { const position = Number(event.target.value); setVisualPosition(position); sendCommand({ type: "seek", position }); }} />
              <div className="time-row"><span>{formatTime(visualPosition)}</span><span>{formatTime(duration)}</span></div>
            </div>
            <div className="transport-controls">
              <Button variant="ghost" size="icon" className="transport-minor" disabled={!isHost} onClick={() => sendCommand({ type: "previous" })} aria-label="Previous track"><SkipBack size={20} /></Button>
              <Button className="transport-play" disabled={!isHost} onClick={() => { if (snapshot) syncAudio({ ...snapshot, playbackState: isPlaying ? "paused" : "playing", playbackPosition: visualPosition, lastUpdated: Date.now() }, clockOffset); sendCommand({ type: isPlaying ? "pause" : "play" }); }} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</Button>
              <Button variant="ghost" size="icon" className="transport-minor" disabled={!isHost} onClick={() => sendCommand({ type: "next" })} aria-label="Next track"><SkipForward size={20} /></Button>
            </div>
            <audio ref={audioRef} onEnded={() => sendCommand({ type: "next" })} onError={event => {
              if (currentTrack?.sourceKind === "local") return;
              const src = event.currentTarget.currentSrc;
              // Browsers report every HTTP failure as "Format error", so ask the server what really happened.
              void (async () => {
                let detail = "";
                try {
                  const probe = await fetch(src, { headers: { Range: "bytes=0-0" } });
                  if (!probe.ok && probe.status !== 206) detail = ` (storage returned ${probe.status}${probe.status === 400 || probe.status === 403 ? ", the file link may have expired" : probe.status === 404 ? ", the file was not found" : ""})`;
                } catch { /* cross-origin or offline: keep the generic message */ }
                setError(currentTrack?.sourceKind === "shared"
                  ? `The host's shared audio could not be loaded${detail || ". Ask the host to upload it again."}`
                  : "This browser could not load the shared demo audio. Check the connection or try another browser.");
              })();
            }} preload="auto" />
            {currentTrack?.sourceKind === "local" && <div className="local-file-bar"><div className="local-file-copy"><FileAudio size={18} /><div><strong>{localFileName || "Matching file not selected"}</strong><small>{localFileName ? "This browser is ready for synchronized playback." : "Select the same file to hear the host’s shared timestamp."}</small></div></div><label className="file-picker-button"><Upload size={14} />{localFileName ? "replace file" : "choose file"}<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" onChange={event => chooseLocalFile(event.target.files?.[0])} /></label></div>}
            {currentTrack?.sourceKind === "local" && localFileName && !audioEnabled && <button className="audio-unlock" onClick={() => void enableListenerAudio()}><Play size={13} fill="currentColor" /> Enable local audio in this browser</button>}
            {currentTrack?.sourceKind !== "local" && !isHost && (!audioEnabled || audioBlocked) && <button className="audio-unlock" onClick={() => void enableListenerAudio()}><Play size={13} fill="currentColor" /> Enable audio for this browser</button>}
            {audioBlocked && currentTrack?.sourceKind !== "local" && isHost && <button className="audio-unlock" onClick={() => void enableListenerAudio()}><Play size={13} fill="currentColor" /> Enable audio for this browser</button>}
            {currentTrack?.sourceKind !== "local" && !isHost && <p className="listener-audio-note">Join users do not control the room, but each browser must tap <strong>Enable audio</strong> once before it can hear the host.</p>}
            <div className="control-caption"><span><Share2 size={14} /> everyone in the room sees the same timestamp</span><span><Wifi size={14} /> latency compensated</span></div>
          </section>

          <aside className="room-sidebar">
            <section className="side-section share-section">
              <div className="side-heading"><div><p className="section-label">invite people</p><h2>Share this room</h2></div><Share2 size={17} /></div>
              <div className="link-box"><LinkIcon size={15} /><span>{shareLink.replace(window.location.origin, "")}</span><button onClick={copyLink} aria-label="Copy room link">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
              <div className="share-actions"><Button variant="outline" onClick={copyLink}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "copied" : "copy link"}</Button><Button variant="outline" onClick={() => setShowQr(value => !value)}><ExternalLink size={15} />{showQr ? "hide QR" : "show QR"}</Button></div>
              {showQr && <div className="qr-wrap">{qrDataUrl ? <img src={qrDataUrl} alt={`QR code for room ${roomId}`} /> : <Loader2 className="spin" size={22} />}<small>scan to join from your phone</small></div>}
            </section>

            <section className="side-section people-section">
              <div className="side-heading"><div><p className="section-label">in the room</p><h2>{onlineUsers} online</h2></div><Users size={17} /></div>
              <div className="people-list">{snapshot?.connectedUsers.map(user => <div className="person-row" key={user.id}><span className={`person-avatar ${user.role === "host" ? "host-avatar" : ""}`}>{user.name.slice(0, 1).toUpperCase()}</span><span className="person-name">{user.name}{user.id === session.userId && <small>you</small>}</span><span className={`person-status ${user.online ? "online" : "offline"}`} /></div>)}</div>
              {session.role === "host" && <button className="end-room-button" onClick={() => void endRoom()}>end room <X size={14} /></button>}
            </section>

            <section className="side-section source-section"><div className="source-icon"><Headphones size={18} /></div><div><p className="section-label">playback source</p><strong>{snapshot?.source.label ?? "Public demo audio"}</strong><p>{snapshot?.source.note ?? "Audio is loaded by each browser directly. We only synchronize controls and timestamps."}</p></div></section>
          </aside>
        </div>

        <section className="queue-section">
          <div className="queue-heading"><div><p className="section-label">room queue</p><h2>Up next</h2></div><div className="queue-actions">{isHost ? <><label className="file-picker-button queue-file-picker"><Upload size={14} /> use local file<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" onChange={event => chooseLocalFile(event.target.files?.[0])} /></label><label className="file-picker-button queue-file-picker shared-upload-picker"><Upload size={14} />{uploading ? " uploading…" : " share with room"}<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" disabled={uploading} onChange={event => shareFileWithRoom(event.target.files?.[0])} /></label><Button variant="outline" onClick={() => setShowSearch(value => !value)}><Search size={15} /> {showSearch ? "close search" : "search catalog"}</Button></> : <span className="host-only-note">host controls the queue</span>}</div></div>
          {showSearch && isHost && <SearchPanel queue={snapshot?.queue ?? []} onSelect={track => { sendCommand({ type: "selectTrack", trackId: track.id }); setShowSearch(false); }} onClose={() => setShowSearch(false)} />}
          <div className="queue-list">{snapshot?.queue.map((track, index) => <button className={`queue-item ${track.id === currentTrack?.id ? "queue-current" : ""}`} key={track.id} disabled={!isHost} onClick={() => sendCommand({ type: "selectTrack", trackId: track.id })}><span className="queue-index">{track.id === currentTrack?.id ? <Play size={12} fill="currentColor" /> : String(index + 1).padStart(2, "0")}</span><span className="queue-swatch" style={{ backgroundColor: track.color }} /><span className="queue-track"><strong>{track.title}</strong><small>{track.artist}</small></span><span className="queue-duration">{formatTime(track.duration)}</span><ChevronRight size={15} /></button>)}</div>
        </section>

        <footer className="room-footer"><span><Radio size={14} /> room state is server-timestamped</span><span>source: public demo catalog</span><span>control permission: shared</span></footer>
      </main>
    </div>
  );
}

export { RoomPage };
export default function Home() {
  return <Landing />;
}
