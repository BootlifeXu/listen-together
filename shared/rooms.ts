export type PlaybackState = "playing" | "paused";

export type DemoTrack = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  audioUrl: string;
  sourceLabel: string;
  color: string;
  sourceKind?: "demo" | "local" | "shared";
};

export type RoomUser = {
  id: string;
  name: string;
  role: "host" | "listener";
  online: boolean;
};

export type RoomSnapshot = {
  roomId: string;
  hostId: string;
  currentTrack: DemoTrack;
  playbackState: PlaybackState;
  playbackPosition: number;
  duration: number;
  lastUpdated: number;
  queue: DemoTrack[];
  connectedUsers: RoomUser[];
  source: {
    kind: "demo" | "local" | "shared";
    label: string;
    note: string;
  };
};

export type RoomCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; position: number }
  | { type: "next" }
  | { type: "previous" }
  | { type: "selectTrack"; trackId: string }
  | { type: "selectLocalTrack"; title: string; artist: string; duration: number; color: string }
  | { type: "selectSharedTrack"; title: string; artist: string; duration: number; color: string; audioUrl: string; storageKey: string };

export type RoomServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot; serverNow: number }
  | { type: "pong"; serverNow: number; clientSentAt?: number }
  | { type: "error"; message: string };

export const DEMO_TRACKS: DemoTrack[] = [
  {
    id: "night-drive",
    title: "Night Drive",
    artist: "SoundHelix demo",
    duration: 372,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    sourceLabel: "Public demo audio",
    color: "#f06a3a",
  },
  {
    id: "soft-focus",
    title: "Soft Focus",
    artist: "SoundHelix demo",
    duration: 301,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    sourceLabel: "Public demo audio",
    color: "#2d8c78",
  },
  {
    id: "after-hours",
    title: "After Hours",
    artist: "SoundHelix demo",
    duration: 264,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    sourceLabel: "Public demo audio",
    color: "#6255a6",
  },
  {
    id: "open-road",
    title: "Open Road",
    artist: "SoundHelix demo",
    duration: 338,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    sourceLabel: "Public demo audio",
    color: "#d28b2f",
  },
  {
    id: "quiet-morning",
    title: "Quiet Morning",
    artist: "SoundHelix demo",
    duration: 287,
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    sourceLabel: "Public demo audio",
    color: "#3e78a6",
  },
];
