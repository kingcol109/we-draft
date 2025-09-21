// src/pages/PlayerProfile.js
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import verifiedBadge from "../assets/verified.png"; // ✅ added badge import

export default function PlayerProfile() {
  const { slug } = useParams(); // ✅ slug from URL
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);
  const { user } = useAuth();

  // Evaluation form state
  const [grade, setGrade] = useState("");
  const [strengths, setStrengths] = useState([]);
  const [weaknesses, setWeaknesses] = useState([]);
  const [nflFit, setNflFit] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [saving, setSaving] = useState(false);

  // Trait state
  const [traits, setTraits] = useState({});

  // Community data
  const [community, setCommunity] = useState({
    avgGrade: null,
    topStrengths: [],
    topWeaknesses: [],
    topFits: [],
  });

  // Public feed
  const [publicFeed, setPublicFeed] = useState([]);

  // Grade mapping
  const gradeScale = {
    "Early First Round": 1,
    "Middle First Round": 2,
    "Late First Round": 3,
    "Second Round": 4,
    "Third Round": 5,
    "Fourth Round": 6,
    "Fifth Round": 7,
    "Sixth Round": 8,
    "Seventh Round": 9,
    UDFA: 10,
  };

  const gradeLabels = {
    1: "Early First Round",
    2: "Middle First Round",
    3: "Late First Round",
    4: "Second Round",
    5: "Third Round",
    6: "Fourth Round",
    7: "Fifth Round",
    8: "Sixth Round",
    9: "Seventh Round",
    10: "UDFA",
  };

  // ✅ simple profanity filter (customize this list)
  const bannedWords = ["faggot", "nigger", "monkey", "nigga", "fuck"]; // add your list here
  const containsProfanity = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return bannedWords.some((word) => lower.includes(word));
  };

  // Fetch player by slug
  useEffect(() => {
    const fetchPlayer = async () => {
      try {
        const q = query(collection(db, "players"), where("Slug", "==", slug));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          setPlayer({ id: d.id, ...d.data() }); // ✅ keep id for evaluations
        }
      } catch (err) {
        console.error("Error fetching player:", err);
      }
    };
    fetchPlayer();
  }, [slug]);

  // Fetch traits
  useEffect(() => {
    const fetchTraits = async () => {
      if (!player?.Position) return;
      try {
        const posRef = doc(db, "traits", player.Position);
        const genRef = doc(db, "traits", "Generic");

        const [posSnap, genSnap] = await Promise.all([getDoc(posRef), getDoc(genRef)]);

        const grouped = {};
        if (posSnap.exists()) grouped["Position Specific"] = (posSnap.data().traits || []).sort();
        if (genSnap.exists()) grouped["Generic"] = (genSnap.data().traits || []).sort();

        setTraits(grouped);
      } catch (err) {
        console.error("Error fetching traits:", err);
      }
    };
    fetchTraits();
  }, [player]);

  // Fetch user’s existing evaluation
  useEffect(() => {
    const fetchEvaluation = async () => {
      if (!user || !player?.id) return;
      try {
        const ref = doc(db, "users", user.uid, "evaluations", player.id);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          setGrade(data.grade || "");
          setStrengths(data.strengths || []);
          setWeaknesses(data.weaknesses || []);
          setNflFit(data.nflFit || "");
          setEvaluation(data.evaluation || "");
          setVisibility(data.visibility || "public");
          setLastUpdated(data.updatedAt || null);
        }
      } catch (err) {
        console.error("Error fetching evaluation:", err);
      }
    };
    fetchEvaluation();
  }, [user, player]);

  // Fetch community + feed
  useEffect(() => {
    const fetchCommunity = async () => {
      if (!player?.id) return;
      try {
        const evalsRef = collection(db, "players", player.id, "evaluations");
        const evalsSnap = await getDocs(evalsRef);

        if (!evalsSnap.empty) {
          let grades = [];
          let strengthCounts = {};
          let weaknessCounts = {};
          let fitCounts = {};
          let publicEvals = [];
          const publicUids = new Set();

          evalsSnap.forEach((d) => {
            const data = d.data();
            if (data.grade && gradeScale[data.grade]) grades.push(gradeScale[data.grade]);
            if (Array.isArray(data.strengths))
              data.strengths.forEach((s) => (strengthCounts[s] = (strengthCounts[s] || 0) + 1));
            if (Array.isArray(data.weaknesses))
              data.weaknesses.forEach((w) => (weaknessCounts[w] = (weaknessCounts[w] || 0) + 1));
            if (data.nflFit) fitCounts[data.nflFit] = (fitCounts[data.nflFit] || 0) + 1;

            // ✅ only allow into public feed if: evaluation text exists AND no profanity
            if (
              data.visibility === "public" &&
              data.evaluation &&
              data.evaluation.trim() !== "" &&
              !containsProfanity(data.evaluation)
            ) {
              publicEvals.push({ id: d.id, ...data });
              if (data.uid) publicUids.add(data.uid);
            }
          });

          // Resolve usernames with verified flag
          const userDocs = await Promise.all(
            Array.from(publicUids).map((uid) => getDoc(doc(db, "users", uid)))
          );
          const usernameMap = {};
          userDocs.forEach((snap) => {
            if (snap.exists()) {
              const u = snap.data();
              usernameMap[snap.id] = {
                name: u.username || u.email || snap.id,
                verified: u.verified || false, // ✅ pick up verified flag
              };
            }
          });

          // Sort public feed
          const toMillis = (ts) =>
            ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0;

          const publicWithNames = publicEvals
            .map((ev) => ({
              ...ev,
              username: usernameMap[ev.uid]?.name || ev.email || "User",
              verified: usernameMap[ev.uid]?.verified || false, // ✅ pass down verified
            }))
            .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));

          setCommunity({
            avgGrade:
              grades.length > 0 ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : null,
            topStrengths: Object.entries(strengthCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([s]) => s),
            topWeaknesses: Object.entries(weaknessCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([w]) => w),
            topFits: Object.entries(fitCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([t]) => t),
          });
          setPublicFeed(publicWithNames);
        } else {
          setCommunity({ avgGrade: null, topStrengths: [], topWeaknesses: [], topFits: [] });
          setPublicFeed([]);
        }
      } catch (err) {
        console.error("Error fetching community data:", err);
      }
    };
    fetchCommunity();
  }, [player]);

  // Save evaluation
  const handleSaveEvaluation = async () => {
    if (!user || !player?.id) return alert("You must sign in first.");

    // ✅ block public saves with profanity
    if (visibility === "public" && containsProfanity(evaluation)) {
      return alert("❌ Your evaluation contains inappropriate language.");
    }

    setSaving(true);

    try {
      const evalData = {
        uid: user.uid,
        email: user.email,
        playerId: player.id,
        playerName: `${player.First || ""} ${player.Last || ""}`.trim(),
        grade,
        strengths,
        weaknesses,
        nflFit,
        evaluation,
        visibility,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "players", player.id, "evaluations", user.uid), evalData);
      await setDoc(doc(db, "users", user.uid, "evaluations", player.id), evalData);

      setLastUpdated(Date.now());
      alert("✅ Evaluation saved!");
    } catch (err) {
      console.error("Error saving evaluation:", err);
      alert("❌ Failed to save evaluation. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const renderDate = (ts) => {
    if (!ts) return "";
    try {
      return ts?.toDate?.()
        ? ts.toDate().toLocaleString()
        : typeof ts === "number"
        ? new Date(ts).toLocaleString()
        : new Date(ts).toLocaleString();
    } catch {
      return "";
    }
  };

  if (!player) {
    return (
      <div className="flex justify-center items-center h-screen text-xl font-bold text-[#0055a5]">
        Loading Player...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 pb-40">
      {/* Header */}
      <div className="flex items-center justify-center mb-2">
        <button
          onClick={() => navigate(-1)}
          className="mr-4 text-[#0055a5] hover:text-[#f6a21d] text-3xl font-bold"
        >
          ←
        </button>
        <h1 className="text-5xl font-extrabold text-center text-[#0055a5]">
          {`${player.First || ""} ${player.Last || ""}`.toUpperCase()}
        </h1>
      </div>

      <p className="text-2xl text-center italic font-bold mb-8 text-[#f6a21d]">
        {`${player.Position || ""} - ${player.School || ""} - ${player.Eligible || ""}`}
      </p>

      {/* Measurements Table */}
      <div className="overflow-x-auto mb-10">
        <table className="min-w-full border-collapse text-center">
          <thead>
            <tr className="bg-[#0055a5] text-white border-4 border-[#f6a21d]">
              <th className="p-3">HT</th>
              <th className="p-3">WT</th>
              <th className="p-3">WING</th>
              <th className="p-3">ARM</th>
              <th className="p-3">HAND</th>
              <th className="p-3">40</th>
              <th className="p-3">VERT</th>
              <th className="p-3">BROAD</th>
              <th className="p-3">3C</th>
              <th className="p-3">SHUTT</th>
              <th className="p-3">BENCH</th>
            </tr>
          </thead>
          <tbody>
            <tr className="odd:bg-white even:bg-white hover:bg-[#e6f0fa]">
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Height || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Weight || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Wingspan || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player["Arm Length"] || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player["Hand Size"] || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player["40 Yard"] || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Vertical || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Broad || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player["3-Cone"] || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Shuttle || "-"}</td>
              <td className="p-3 border border-[#f6a21d] text-sm">{player.Bench || "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Community Grades */}
      <div className="mb-10">
        <h2 className="text-3xl font-bold text-[#0055a5] mb-4">Community Grades</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Grade */}
          <div className="bg-white border-4 border-[#f6a21d] rounded-lg shadow text-center">
            <div className="bg-[#0055a5] text-white font-bold py-2 rounded-t">GRADE</div>
            <div className="p-4 text-xl font-bold">
              {community.avgGrade
                ? gradeLabels[Math.round(community.avgGrade)] || "No grade yet"
                : "No grade yet"}
            </div>
          </div>

          {/* Strengths */}
          <div className="bg-white border-4 border-[#f6a21d] rounded-lg shadow text-center">
            <div className="bg-[#0055a5] text-white font-bold py-2 rounded-t">STRENGTHS</div>
            <div className="p-4 text-left">
              {community.topStrengths.length > 0 ? (
                <ol className="list-decimal ml-5">
                  {community.topStrengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : (
                <p className="italic text-gray-500">No strengths yet</p>
              )}
            </div>
          </div>

          {/* Weaknesses */}
          <div className="bg-white border-4 border-[#f6a21d] rounded-lg shadow text-center">
            <div className="bg-[#0055a5] text-white font-bold py-2 rounded-t">WEAKNESSES</div>
            <div className="p-4 text-left">
              {community.topWeaknesses.length > 0 ? (
                <ol className="list-decimal ml-5">
                  {community.topWeaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
              ) : (
                <p className="italic text-gray-500">No weaknesses yet</p>
              )}
            </div>
          </div>

          {/* NFL Fit */}
          <div className="bg-white border-4 border-[#f6a21d] rounded-lg shadow text-center">
            <div className="bg-[#0055a5] text-white font-bold py-2 rounded-t">NFL FIT</div>
            <div className="p-4 text-left">
              {community.topFits.length > 0 ? (
                <ol className="list-decimal ml-5">
                  {community.topFits.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              ) : (
                <p className="italic text-gray-500">No team fits yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Evaluation Form */}
      <div className="bg-white border-4 border-[#f6a21d] rounded-lg p-6 shadow mb-10">
        <h2 className="text-2xl font-bold text-[#0055a5] mb-4 text-center">Your Evaluation</h2>

        {!user ? (
          <p className="text-center text-red-600 font-semibold">
            Please sign in to submit an evaluation.
          </p>
        ) : (
          <>
            {/* Grade */}
            <label className="block font-semibold mb-2">Grade</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full border-2 border-[#0055a5] rounded px-3 py-2 mb-4"
            >
              <option value="">Select a grade</option>
              {[
                "Watchlist",
                "Early First Round",
                "Middle First Round",
                "Late First Round",
                "Second Round",
                "Third Round",
                "Fourth Round",
                "Fifth Round",
                "Sixth Round",
                "Seventh Round",
                "UDFA",
              ].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>

            {/* Strengths & Weaknesses */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Strengths */}
              <div>
                <label className="block font-semibold mb-2">Strengths (max 3)</label>
                <details className="w-full border-2 border-[#0055a5] rounded">
                  <summary className="cursor-pointer px-3 py-2 bg-white">
                    {strengths.length > 0 ? strengths.join(", ") : "Select strengths"}
                  </summary>
                  <div className="max-h-40 overflow-y-auto px-3 py-2 bg-white">
                    {Object.entries(traits).map(([label, options]) => (
                      <div key={label} className="mb-2">
                        <p className="font-bold text-[#0055a5]">{label}</p>
                        {options.map((trait) => (
                          <label key={trait} className="block text-sm">
                            <input
                              type="checkbox"
                              checked={strengths.includes(trait)}
                              disabled={
                                (!strengths.includes(trait) && strengths.length >= 3) ||
                                weaknesses.includes(trait)
                              }
                              onChange={() =>
                                setStrengths(
                                  strengths.includes(trait)
                                    ? strengths.filter((s) => s !== trait)
                                    : [...strengths, trait]
                                )
                              }
                              className="mr-2"
                            />
                            {trait}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              {/* Weaknesses */}
              <div>
                <label className="block font-semibold mb-2">Weaknesses (max 3)</label>
                <details className="w-full border-2 border-[#0055a5] rounded">
                  <summary className="cursor-pointer px-3 py-2 bg-white">
                    {weaknesses.length > 0 ? weaknesses.join(", ") : "Select weaknesses"}
                  </summary>
                  <div className="max-h-40 overflow-y-auto px-3 py-2 bg-white">
                    {Object.entries(traits).map(([label, options]) => (
                      <div key={label} className="mb-2">
                        <p className="font-bold text-[#0055a5]">{label}</p>
                        {options.map((trait) => (
                          <label key={trait} className="block text-sm">
                            <input
                              type="checkbox"
                              checked={weaknesses.includes(trait)}
                              disabled={
                                (!weaknesses.includes(trait) && weaknesses.length >= 3) ||
                                strengths.includes(trait)
                              }
                              onChange={() =>
                                setWeaknesses(
                                  weaknesses.includes(trait)
                                    ? weaknesses.filter((w) => w !== trait)
                                    : [...weaknesses, trait]
                                )
                              }
                              className="mr-2"
                            />
                            {trait}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>

            {/* NFL Fit */}
            <label className="block font-semibold mb-2">NFL Fit</label>
            <select
              value={nflFit}
              onChange={(e) => setNflFit(e.target.value)}
              className="w-full border-2 border-[#0055a5] rounded px-3 py-2 mb-4"
            >
              <option value="">Select an NFL team</option>
              {[
                "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills",
                "Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns",
                "Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
                "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs",
                "Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins",
                "Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants",
                "New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers",
                "Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders"
              ].map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>

            {/* Evaluation */}
            <label className="block font-semibold mb-2">Evaluation</label>
            <textarea
              value={evaluation}
              onChange={(e) => setEvaluation(e.target.value)}
              placeholder="Write your evaluation..."
              className="w-full border-2 border-[#0055a5] rounded px-3 py-2 h-32 mb-4"
            />

            {/* Visibility */}
            <label className="block font-semibold mb-2">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="w-full border-2 border-[#0055a5] rounded px-3 py-2 mb-4"
            >
              <option value="public">🌍 Public</option>
              <option value="private">🔒 Private</option>
            </select>

            <button
              onClick={handleSaveEvaluation}
              disabled={saving}
              className="w-full bg-[#0055a5] text-white font-bold py-2 rounded border-2 border-[#f6a21d] hover:bg-[#003f7d] transition"
            >
              {saving ? "Saving..." : "Save Evaluation"}
            </button>

            {lastUpdated && (
              <p className="text-sm text-gray-500 text-center mt-2">
                Last updated: {renderDate(lastUpdated)}
              </p>
            )}
          </>
        )}
      </div>

      {/* Public Feed */}
      <div>
        <h2 className="text-3xl font-bold text-[#0055a5] mb-4">🌍 Public Evaluations</h2>
        {publicFeed.length > 0 ? (
          publicFeed.map((ev) => (
            <div
              key={ev.uid}
              className="bg-white border-4 border-[#f6a21d] rounded-lg p-4 mb-4 shadow"
            >
              <p className="font-bold text-[#0055a5] flex items-center">
                {ev.username}
                {ev.verified && (
                  <img
                    src={verifiedBadge}
                    alt="Verified"
                    className="ml-2 w-5 h-5 inline-block"
                  />
                )}
              </p>
              <p className="mb-2">
                <span className="font-bold">Grade:</span>{" "}
                <span className="font-bold">{ev.grade || "N/A"}</span>
              </p>
              {ev.strengths?.length > 0 && (
                <p>
                  <span className="font-semibold">Strengths:</span> {ev.strengths.join(", ")}
                </p>
              )}
              {ev.weaknesses?.length > 0 && (
                <p>
                  <span className="font-semibold">Weaknesses:</span> {ev.weaknesses.join(", ")}
                </p>
              )}
              {ev.nflFit && (
                <p>
                  <span className="font-semibold">NFL Fit:</span> {ev.nflFit}
                </p>
              )}
              {ev.evaluation && <p className="italic mt-2">"{ev.evaluation}"</p>}
              {ev.updatedAt && (
                <p className="text-xs text-gray-500 mt-3">{renderDate(ev.updatedAt)}</p>
              )}
            </div>
          ))
        ) : (
          <p className="italic text-gray-500">No public evaluations yet.</p>
        )}
      </div>
    </div>
  );
}
