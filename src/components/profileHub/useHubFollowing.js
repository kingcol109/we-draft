// src/components/profileHub/useHubFollowing.js
//
// The profile hub's view of everything the user follows (utils/profileHub.js):
// { players: [{ follow, photo, snap }], college: [team snapshot], nfl:
// [team snapshot + abbr] } — null while it loads. Shared by the Following
// and Feed tabs; the ESPN reads behind it are cached for the visit.
import { useEffect, useState } from "react";
import { loadFollowing, loadPhotos, loadSchoolsById, playerSnapshot, teamSnapshot, nflTeamSnapshot } from "../../utils/profileHub";

const memo = new Map();

async function load(uid) {
  const f = await loadFollowing(uid);
  const [photos, schools] = await Promise.all([loadPhotos(f.players.map((p) => p.playerId || p.id)), loadSchoolsById(f.college)]);
  const [players, college, nfl] = await Promise.all([
    Promise.all(f.players.map(async (follow) => {
      const photo = photos[follow.playerId || follow.id] || {};
      return { follow, photo, snap: photo.espnId ? await playerSnapshot(photo.espnId).catch(() => null) : null };
    })),
    Promise.all(f.college.map(async (id) => { const t = await teamSnapshot("college-football", id).catch(() => null); return t && { ...t, ...(schools[id] || {}) }; })),
    Promise.all(f.nfl.map(async (abbr) => { const s = await nflTeamSnapshot(abbr).catch(() => null); return s && { ...s, abbr }; })),
  ]);
  return { players, college: college.filter(Boolean), nfl: nfl.filter(Boolean) };
}

export default function useHubFollowing(uid) {
  const [data, setData] = useState(() => (uid && memo.get(uid)?.value) || null);
  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    if (!memo.has(uid)) memo.set(uid, { promise: load(uid) });
    const entry = memo.get(uid);
    entry.promise.then((v) => { entry.value = v; if (live) setData(v); }).catch(() => { memo.delete(uid); if (live) setData({ players: [], college: [], nfl: [] }); });
    return () => { live = false; };
  }, [uid]);
  return data;
}
