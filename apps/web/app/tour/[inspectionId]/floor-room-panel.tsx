"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Floor, Room } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import styles from "./tour-screen.module.css";

/**
 * Shared floor+room switcher behind both "🚪 החלף חדר" and "🏢 החלף קומה" (spec §10) — one tap picks a
 * floor and reveals its rooms, a second tap picks the room and closes the panel: the 1–2 taps spec §75
 * asks common actions to take, not two separate near-identical screens.
 */
export function FloorRoomPanel({
  projectId,
  currentFloorId,
  currentRoomId,
  onSelectFloor,
  onSelectRoom,
  onClose,
}: {
  projectId: string;
  currentFloorId: string | null;
  currentRoomId: string | null;
  onSelectFloor: (floorId: string) => void;
  onSelectRoom: (floorId: string, roomId: string) => void;
  onClose: () => void;
}) {
  const [expandedFloorId, setExpandedFloorId] = useState<string | null>(currentFloorId);

  const floors = useLiveQuery(async () => {
    const rows = await getLocalDb().floors.where("projectId").equals(projectId).toArray();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [projectId]);

  const rooms = useLiveQuery(
    () => (expandedFloorId ? getLocalDb().rooms.where("floorId").equals(expandedFloorId).toArray() : Promise.resolve<Room[]>([])),
    [expandedFloorId]
  );

  function handleFloorTap(floor: Floor) {
    setExpandedFloorId(floor.id);
    onSelectFloor(floor.id);
  }

  function handleRoomTap(room: Room) {
    if (!expandedFloorId) return;
    onSelectRoom(expandedFloorId, room.id);
    onClose();
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>החלפת קומה / חדר</span>
        <button className={styles.panelClose} onClick={onClose} aria-label="סגור">
          ✕
        </button>
      </div>

      {floors === undefined ? (
        <p className={styles.hint}>טוען…</p>
      ) : floors.length === 0 ? (
        <p className={styles.hint}>אין עדיין קומות בפרויקט זה. ניתן להוסיף מסך הפרויקט.</p>
      ) : (
        <ul className={styles.panelList}>
          {floors.map((floor) => (
            <li key={floor.id}>
              <button
                className={styles.panelListItem}
                onClick={() => handleFloorTap(floor)}
                style={floor.id === currentFloorId ? { outline: "2px solid var(--accent)" } : undefined}
              >
                <span>🏢 {floor.name}</span>
                {floor.id === expandedFloorId ? <span>▾</span> : null}
              </button>

              {floor.id === expandedFloorId ? (
                <ul className={styles.panelList} style={{ marginTop: 8, marginRight: 14 }}>
                  {rooms === undefined ? (
                    <li className={styles.hint}>טוען חדרים…</li>
                  ) : rooms.length === 0 ? (
                    <li className={styles.hint}>אין עדיין חדרים בקומה זו.</li>
                  ) : (
                    rooms.map((room) => (
                      <li key={room.id}>
                        <button
                          className={styles.panelListItem}
                          onClick={() => handleRoomTap(room)}
                          style={room.id === currentRoomId ? { outline: "2px solid var(--accent)" } : undefined}
                        >
                          🚪 {room.name}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
