import { describe, expect, it } from "vitest";
import { applyRoomCommand, createRoom, endRoom, getRoomSnapshot, joinRoom, searchDemoTracks } from "./rooms";

describe("room state", () => {
  it("creates a host room with a timestamped demo queue", () => {
    const result = createRoom("Alex");
    expect(result.roomId).toMatch(/^[A-Z0-9]{6}$/);
    expect(result.snapshot.hostId).toBe(result.userId);
    expect(result.snapshot.currentTrack.id).toBe("night-drive");
    expect(result.snapshot.playbackState).toBe("paused");
    expect(result.snapshot.lastUpdated).toBeGreaterThan(0);
  });

  it("adds a listener without changing the authoritative track state", () => {
    const room = createRoom("Host");
    const joined = joinRoom(room.roomId, "Taylor");
    expect(joined?.userId).toBeTruthy();
    expect(joined?.snapshot.connectedUsers).toHaveLength(2);
    expect(joined?.snapshot.connectedUsers[1]).toMatchObject({ name: "Taylor", role: "listener", online: false });
    expect(joined?.snapshot.currentTrack.id).toBe(room.snapshot.currentTrack.id);
  });

  it("searches only the supported demo catalog", () => {
    expect(searchDemoTracks("night").map(track => track.id)).toEqual(["night-drive"]);
    expect(searchDemoTracks("not in catalog")).toEqual([]);
  });

  it("switches to local-file metadata without storing an audio URL", () => {
    const room = createRoom("Host");
    expect(applyRoomCommand(room.roomId, {
      type: "selectLocalTrack",
      title: "My Song",
      artist: "Me",
      duration: 182.4,
      color: "#1e1d1b",
    })).toBe(true);
    const snapshot = getRoomSnapshot(room.roomId);
    expect(snapshot?.source.kind).toBe("local");
    expect(snapshot?.currentTrack.sourceKind).toBe("local");
    expect(snapshot?.currentTrack.audioUrl).toBe("");
    expect(snapshot?.duration).toBe(182.4);
  });

  it("switches to host-shared audio with a browser-playable URL", () => {
    const room = createRoom("Host");
    expect(applyRoomCommand(room.roomId, {
      type: "selectSharedTrack",
      title: "Shared Song",
      artist: "Uploaded by host",
      duration: 205,
      color: "#f06a3a",
      audioUrl: "/manus-storage/rooms/test/shared-song.mp3",
      storageKey: "rooms/test/shared-song.mp3",
    })).toBe(true);
    const snapshot = getRoomSnapshot(room.roomId);
    expect(snapshot?.source.kind).toBe("shared");
    expect(snapshot?.currentTrack.sourceKind).toBe("shared");
    expect(snapshot?.currentTrack.audioUrl).toContain("/manus-storage/");
  });

  it("allows only the host to end a room", () => {
    const room = createRoom("Host");
    const joined = joinRoom(room.roomId, "Listener");
    expect(endRoom(room.roomId, joined?.userId ?? "")).toBe(false);
    expect(getRoomSnapshot(room.roomId)).not.toBeNull();
    expect(endRoom(room.roomId, room.userId)).toBe(true);
    expect(getRoomSnapshot(room.roomId)).toBeNull();
  });
});
