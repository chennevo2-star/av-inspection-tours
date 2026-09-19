"use client";

import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Floor, Room } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import { createFloor, deleteFloor } from "../../../lib/db/floors";
import { createRoom, deleteRoom } from "../../../lib/db/rooms";
import { useMounted } from "../../../lib/hooks/use-mounted";
import { FloorImportModal } from "./floor-import-modal";
import styles from "./project-screen.module.css";

/**
 * Floors & Rooms (spec §Floor, §Room). Each floor lists its rooms inline with an add-room mini-form. Also
 * offers importing the floor list straight from a single-line riser-diagram PDF (user request) via
 * FloorImportModal, as an alternative to typing each floor in by hand.
 */
export function FloorsSection({ projectId }: { projectId: string }) {
  const mounted = useMounted();
  const [floorName, setFloorName] = useState("");
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const floors = useLiveQuery(async () => {
    if (!mounted) return [] as Floor[];
    const rows = await getLocalDb().floors.where("projectId").equals(projectId).toArray();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [mounted, projectId]);

  async function handleAddFloor(event: FormEvent) {
    event.preventDefault();
    const name = floorName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createFloor(projectId, name);
      setFloorName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>קומות וחדרים</h2>

      <button
        type="button"
        className={styles.addButton}
        style={{ marginBottom: 14 }}
        onClick={() => setImportOpen(true)}
      >
        📄 ייבוא קומות מסכמה חד קווית
      </button>

      {importOpen ? <FloorImportModal projectId={projectId} onClose={() => setImportOpen(false)} /> : null}

      <form className={styles.inlineForm} onSubmit={handleAddFloor}>
        <input
          placeholder="שם קומה (למשל: קומה 30)"
          value={floorName}
          onChange={(e) => setFloorName(e.target.value)}
          aria-label="שם קומה"
        />
        <button className={styles.addButton} type="submit" disabled={creating || !floorName.trim()}>
          הוסף קומה
        </button>
      </form>

      {!mounted || floors === undefined ? (
        <p className={styles.emptyHint}>טוען…</p>
      ) : floors.length === 0 ? (
        <p className={styles.emptyHint}>אין עדיין קומות בפרויקט זה.</p>
      ) : (
        <ul className={styles.list}>
          {floors.map((floor) => (
            <FloorRow key={floor.id} floor={floor} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FloorRow({ floor }: { floor: Floor }) {
  const [roomName, setRoomName] = useState("");

  const rooms = useLiveQuery(
    () => getLocalDb().rooms.where("floorId").equals(floor.id).toArray(),
    [floor.id]
  );

  async function handleAddRoom(event: FormEvent) {
    event.preventDefault();
    const name = roomName.trim();
    if (!name) return;
    await createRoom(floor.id, name);
    setRoomName("");
  }

  return (
    <li className={styles.floorBlock}>
      <div className={styles.floorHeader}>
        <span className={styles.itemName}>{floor.name}</span>
        <button className={styles.deleteButton} onClick={() => deleteFloor(floor.id)}>
          הסר קומה
        </button>
      </div>

      {rooms && rooms.length > 0 ? (
        <div className={styles.roomChips}>
          {rooms.map((room: Room) => (
            <span key={room.id} className={styles.roomChip}>
              {room.name}
              <button onClick={() => deleteRoom(room.id)} aria-label={`הסר חדר ${room.name}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className={styles.emptyHint} style={{ margin: "0 0 10px" }}>
          אין עדיין חדרים בקומה זו.
        </p>
      )}

      <form onSubmit={handleAddRoom} style={{ display: "flex", gap: 6 }}>
        <input
          placeholder="שם חדר (למשל: חדר ישיבות גדול)"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg)",
            border: "1px solid var(--surface-2)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 13,
          }}
        />
        <button className={styles.deleteButton} style={{ color: "var(--accent)" }} type="submit">
          הוסף חדר
        </button>
      </form>
    </li>
  );
}
