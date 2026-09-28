import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  DEMO_TRACKS,
  type DemoTrack,
  type RoomCommand,
  type RoomServerMessage,
  type RoomSnapshot,
  type RoomUser,
} from "../shared/rooms";
import { storageDelete, storagePut } from "./storage";

type RoomConnection = {
  userId: string;
  socket?: WebSocket;
};

type RoomRecord = {
  snapshot: RoomSnapshot;
  users: Map<string, RoomConnection>;
  // Storage keys of files the host shared; deleted when the room ends or expires.
  storageKeys: string[];
};

const rooms = new Map<string, RoomRecord>();
const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOMS = 500;
const MAX_USERS_PER_ROOM = 50;
const ROOM_TTL_MS = 1000 * 60 * 60 * 12;

function createRoomId() {
  let roomId = "";
  do {
    roomId = Array.from({ length: 6 }, () =>
      ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)]
    ).join("");
  } while (rooms.has(roomId));
  return roomId;
}

function createUserId() {
  return `user_${randomBytes(8).toString("hex")}`;
}

function normalizeName(name: unknown, fallback: string) {
  if (typeof name !== "string") return fallback;
  const clean = name.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 24);
  return clean || fallback;
}

function getLivePosition(snapshot: RoomSnapshot, at = Date.now()) {
  if (snapshot.playbackState !== "playing") return snapshot.playbackPosition;
  const elapsed = Math.max(0, at - snapshot.lastUpdated) / 1000;
  return Math.min(snapshot.duration, snapshot.playbackPosition + elapsed);
}

function withFreshPosition(snapshot: RoomSnapshot, at = Date.now()) {
  return {
    ...snapshot,
    playbackPosition: getLivePosition(snapshot, at),
    lastUpdated: at,
  };
}

function publicSnapshot(room: RoomRecord): RoomSnapshot {
  const snapshot = withFreshPosition(room.snapshot);
  room.snapshot = snapshot;
  return {
    ...snapshot,
    connectedUsers: snapshot.connectedUsers.map(user => ({ ...user })),
    queue: snapshot.queue.map(track => ({ ...track })),
    currentTrack: { ...snapshot.currentTrack },
  };
}

function sendSnapshot(room: RoomRecord) {
  const message: RoomServerMessage = {
    type: "snapshot",
    snapshot: publicSnapshot(room),
    serverNow: Date.now(),
  };
  const encoded = JSON.stringify(message);
  for (const connection of Array.from(room.users.values())) {
    if (connection.socket?.readyState === WebSocket.OPEN) {
      connection.socket.send(encoded);
    }
  }
}

function findRoom(roomId: string) {
  return rooms.get(roomId.toUpperCase());
}

function userFromRoom(room: RoomRecord, userId: string) {
  return room.snapshot.connectedUsers.find(user => user.id === userId);
}

function markUserOnline(room: RoomRecord, userId: string, socket: WebSocket) {
  const connection = room.users.get(userId);
  if (!connection) return false;
  connection.socket = socket;
  const user = userFromRoom(room, userId);
  if (user) user.online = true;
  return true;
}

function disconnectUser(room: RoomRecord, userId: string, socket: WebSocket) {
  const connection = room.users.get(userId);
  if (!connection || connection.socket !== socket) return;
  connection.socket = undefined;
  const user = userFromRoom(room, userId);
  if (user) user.online = false;
  sendSnapshot(room);
}

function applyCommand(room: RoomRecord, command: RoomCommand) {
  const now = Date.now();
  const snapshot = withFreshPosition(room.snapshot, now);

  if (command.type === "play") {
    snapshot.playbackState = "playing";
    snapshot.lastUpdated = now;
  } else if (command.type === "pause") {
    snapshot.playbackState = "paused";
    snapshot.lastUpdated = now;
  } else if (command.type === "seek") {
    snapshot.playbackPosition = Math.max(0, Math.min(snapshot.duration, command.position));
    snapshot.lastUpdated = now;
  } else if (command.type === "selectTrack") {
    const selected = snapshot.queue.find(track => track.id === command.trackId);
    if (!selected) return;
    snapshot.currentTrack = selected;
    snapshot.duration = selected.duration;
    snapshot.playbackPosition = 0;
    snapshot.lastUpdated = now;
    snapshot.source = {
      kind: "demo",
      label: selected.sourceLabel,
      note: "A shared, browser-readable source used only to demonstrate synchronized control.",
    };
  } else if (command.type === "selectLocalTrack") {
    const safeTitle = command.title.trim().slice(0, 80) || "Local file";
    const safeArtist = command.artist.trim().slice(0, 80) || "Selected on each device";
    const safeDuration = Math.max(1, Math.min(60 * 60 * 12, Number(command.duration) || 1));
    const localTrack: DemoTrack = {
      id: `local-${randomBytes(6).toString("hex")}`,
      title: safeTitle,
      artist: safeArtist,
      duration: safeDuration,
      audioUrl: "",
      sourceLabel: "Local file",
      sourceKind: "local",
      color: command.color || "#1e1d1b",
    };
    snapshot.currentTrack = localTrack;
    snapshot.duration = safeDuration;
    snapshot.playbackPosition = 0;
    snapshot.lastUpdated = now;
    snapshot.source = {
      kind: "local",
      label: "Matching local file",
      note: "Each listener selects the same file locally; the server never receives or redistributes the audio.",
    };
  } else if (command.type === "selectSharedTrack") {
    const safeTitle = command.title.trim().slice(0, 80) || "Shared audio";
    const safeArtist = command.artist.trim().slice(0, 80) || "Uploaded by host";
    const safeDuration = Math.max(1, Math.min(60 * 60 * 12, Number(command.duration) || 1));
    snapshot.currentTrack = {
      id: `shared-${randomBytes(6).toString("hex")}`,
      title: safeTitle,
      artist: safeArtist,
      duration: safeDuration,
      audioUrl: command.audioUrl,
      sourceLabel: "Host shared audio",
      sourceKind: "shared",
      color: command.color || "#1e1d1b",
    };
    snapshot.duration = safeDuration;
    snapshot.playbackPosition = 0;
    snapshot.lastUpdated = now;
    snapshot.source = {
      kind: "shared",
      label: "Host shared audio",
      note: "The host uploaded this audio. Room members stream it from temporary storage; only use recordings you are allowed to share.",
    };
  } else if (command.type === "next" || command.type === "previous") {
    const currentIndex = snapshot.queue.findIndex(track => track.id === snapshot.currentTrack.id);
    const offset = command.type === "next" ? 1 : -1;
    const nextIndex = (currentIndex + offset + snapshot.queue.length) % snapshot.queue.length;
    const selected = snapshot.queue[nextIndex];
    snapshot.currentTrack = selected;
    snapshot.duration = selected.duration;
    snapshot.playbackPosition = 0;
    snapshot.lastUpdated = now;
    snapshot.source = {
      kind: selected.sourceKind === "local" ? "local" : selected.sourceKind === "shared" ? "shared" : "demo",
      label: selected.sourceKind === "local" ? "Matching local file" : selected.sourceKind === "shared" ? "Host shared audio" : selected.sourceLabel,
      note: selected.sourceKind === "local"
        ? "Each listener selects the same file locally; the server never receives or redistributes the audio."
        : selected.sourceKind === "shared"
          ? "The host uploaded this audio. Room members stream it from temporary storage; only use recordings you are allowed to share."
        : "A shared, browser-readable source used only to demonstrate synchronized control.",
    };
  }

  room.snapshot = snapshot;
  sendSnapshot(room);
}

export function createRoom(hostName?: unknown) {
  if (rooms.size >= MAX_ROOMS) throw new Error("Room capacity reached. Try again later.");
  const roomId = createRoomId();
  const hostId = createUserId();
  const room: RoomRecord = {
    snapshot: {
      roomId,
      hostId,
      currentTrack: DEMO_TRACKS[0],
      playbackState: "paused",
      playbackPosition: 0,
      duration: DEMO_TRACKS[0].duration,
      lastUpdated: Date.now(),
      queue: DEMO_TRACKS,
      connectedUsers: [
        {
          id: hostId,
          name: normalizeName(hostName, "Host"),
          role: "host",
          online: false,
        },
      ],
      source: {
        kind: "demo",
        label: "Public demo audio",
        note: "A shared, browser-readable source used only to demonstrate synchronized control.",
      },
    },
    users: new Map([[hostId, { userId: hostId }]]),
    storageKeys: [],
  };
  rooms.set(roomId, room);
  return { roomId, userId: hostId, snapshot: publicSnapshot(room) };
}

export function joinRoom(roomId: string, name?: unknown) {
  const room = findRoom(roomId);
  if (!room) return null;
  if (room.users.size >= MAX_USERS_PER_ROOM) throw new Error("This room is full.");
  const userId = createUserId();
  const user: RoomUser = {
    id: userId,
    name: normalizeName(name, `Listener ${room.users.size}`),
    role: "listener",
    online: false,
  };
  room.users.set(userId, { userId });
  room.snapshot.connectedUsers.push(user);
  return { roomId: room.snapshot.roomId, userId, snapshot: publicSnapshot(room) };
}

export function getRoomSnapshot(roomId: string) {
  const room = findRoom(roomId);
  return room ? publicSnapshot(room) : null;
}

export function applyRoomCommand(roomId: string, command: RoomCommand) {
  const room = findRoom(roomId);
  if (!room) return false;
  applyCommand(room, command);
  return true;
}

export function endRoom(roomId: string, userId: string) {
  const room = findRoom(roomId);
  if (!room || room.snapshot.hostId !== userId) return false;
  for (const connection of Array.from(room.users.values())) {
    if (connection.socket?.readyState === WebSocket.OPEN) {
      connection.socket.close(1000, "Room ended by host");
    }
  }
  rooms.delete(room.snapshot.roomId);
  void purgeRoomFiles(room);
  return true;
}

function purgeRoomFiles(room: RoomRecord) {
  const keys = room.storageKeys.splice(0);
  if (!keys.length) return Promise.resolve();
  return storageDelete(keys).catch(error => {
    console.error("[rooms] could not delete shared audio:", error instanceof Error ? error.message : error);
  });
}

// "My Song (Live) 2024.mp3" -> { title: "My Song (Live) 2024", slug: "my-song-live-2024", ext: "mp3" }
function describeUpload(rawName: unknown, mimeType: string) {
  const name = String(rawName ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const dot = name.lastIndexOf(".");
  const rawExt = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const mimeExt: Record<string, string> = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
    "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/flac": "flac", "audio/webm": "webm",
  };
  const ext = /^[a-z0-9]{2,5}$/.test(rawExt) ? rawExt : mimeExt[mimeType] ?? "audio";
  const base = dot > 0 ? name.slice(0, dot) : name;
  const title = base.trim().slice(0, 80) || "Shared audio";
  const slug =
    base.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "audio";
  return { title, slug, ext };
}

export function searchDemoTracks(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return DEMO_TRACKS;
  return DEMO_TRACKS.filter(track =>
    `${track.title} ${track.artist}`.toLowerCase().includes(normalizedQuery)
  );
}

function jsonError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

export function registerRoomRoutes(app: Express) {
  app.post("/api/rooms", (req: Request, res: Response) => {
    try {
      res.status(201).json(createRoom(req.body?.name));
    } catch (error) {
      jsonError(res, 503, error instanceof Error ? error.message : "Unable to create room");
    }
  });

  app.post("/api/rooms/:roomId/join", (req: Request, res: Response) => {
    try {
      const result = joinRoom(req.params.roomId, req.body?.name);
      if (!result) return jsonError(res, 404, "That room does not exist or has expired.");
      res.status(201).json(result);
    } catch (error) {
      jsonError(res, 409, error instanceof Error ? error.message : "Unable to join room");
    }
  });

  app.post("/api/rooms/:roomId/upload", async (req: Request, res: Response) => {
    try {
      const room = findRoom(req.params.roomId);
      const userId = String(req.body?.userId ?? "");
      if (!room) return jsonError(res, 404, "That room does not exist or has expired.");
      if (room.snapshot.hostId !== userId) return jsonError(res, 403, "Only the host can share an upload.");
      const data = String(req.body?.data ?? "");
      const mimeType = String(req.body?.mimeType ?? "audio/mpeg");
      const duration = Number(req.body?.duration ?? 0);
      if (!data || !mimeType.startsWith("audio/") || !Number.isFinite(duration) || duration <= 0) {
        return jsonError(res, 400, "Provide a valid audio file and duration.");
      }
      const base64 = data.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length === 0) return jsonError(res, 400, "The uploaded file was empty.");
      if (bytes.length > 25 * 1024 * 1024) return jsonError(res, 413, "Shared audio must be 25 MB or smaller.");
      const { title, slug, ext } = describeUpload(req.body?.fileName, mimeType);
      const stored = await storagePut(`rooms/${room.snapshot.roomId}/${slug}.${ext}`, bytes, mimeType);
      room.storageKeys.push(stored.key);
      applyCommand(room, {
        type: "selectSharedTrack",
        title,
        artist: "Uploaded by host",
        duration,
        color: "#f06a3a",
        audioUrl: stored.url,
        storageKey: stored.key,
      });
      res.status(201).json({ url: stored.url, key: stored.key });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : "Unable to share audio");
    }
  });

  app.get("/api/rooms/:roomId", (req: Request, res: Response) => {
    const snapshot = getRoomSnapshot(req.params.roomId);
    if (!snapshot) return jsonError(res, 404, "That room does not exist or has expired.");
    res.json(snapshot);
  });

  app.delete("/api/rooms/:roomId", (req: Request, res: Response) => {
    const ended = endRoom(req.params.roomId, String(req.body?.userId ?? ""));
    if (!ended) return jsonError(res, 403, "Only the host can end this room.");
    res.status(204).end();
  });

  app.get("/api/search", (req: Request, res: Response) => {
    res.json({ results: searchDemoTracks(String(req.query.q ?? "")) });
  });
}

export function attachRoomWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/rooms/ws") return;
    const roomId = url.searchParams.get("roomId")?.toUpperCase();
    const userId = url.searchParams.get("userId");
    const room = roomId ? findRoom(roomId) : undefined;
    if (!room || !userId || !room.users.has(userId)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, request, room, userId);
    });
  });

  wss.on("connection", ((socket: WebSocket, _request: IncomingMessage, room: RoomRecord, userId: string) => {
    markUserOnline(room, userId, socket);
    sendSnapshot(room);

    socket.on("message", (raw: RawData) => {
      try {
        const payload = JSON.parse(raw.toString()) as { kind?: string; command?: RoomCommand; clientSentAt?: number };
        if (payload.kind === "ping") {
          const response: RoomServerMessage = {
            type: "pong",
            serverNow: Date.now(),
            clientSentAt: payload.clientSentAt,
          };
          socket.send(JSON.stringify(response));
          return;
        }
        if (!payload.command || !["play", "pause", "seek", "next", "previous", "selectTrack", "selectLocalTrack", "selectSharedTrack"].includes(payload.command.type)) {
          throw new Error("Unsupported room command");
        }
        if (room.snapshot.hostId !== userId) {
          throw new Error("Only the host can change shared playback.");
        }
        applyCommand(room, payload.command);
      } catch (error) {
        const response: RoomServerMessage = {
          type: "error",
          message: error instanceof Error ? error.message : "Invalid room message",
        };
        socket.send(JSON.stringify(response));
      }
    });

    socket.on("close", () => disconnectUser(room, userId, socket));
    socket.on("error", () => disconnectUser(room, userId, socket));
  }) as Parameters<typeof wss.on>[1]);

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [roomId, room] of Array.from(rooms.entries())) {
      if (room.snapshot.lastUpdated < cutoff && Array.from(room.users.values()).every(connection => !connection.socket)) {
        rooms.delete(roomId);
        void purgeRoomFiles(room);
      }
    }
  }, 1000 * 60 * 15);
  cleanup.unref();
}
