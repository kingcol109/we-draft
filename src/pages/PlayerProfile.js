// src/pages/PlayerProfile.js
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Logo1 from "../assets/Logo1.png";
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
import verifiedBadge from "../assets/verified.png";
import { Helmet } from "react-helmet";

// --- image URL helpers ---
function sanitizeImgur(url) {
  if (!url) return "";
  // If it's already a direct i.imgur link, return as-is
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;

  // If it's a single-image page like https://imgur.com/abc123, convert to i.imgur.com/abc123.png
  const singleMatch = url.match(/^https?:\/\/imgur\.com\/(?!a\/|gallery\/)([A-Za-z0-9]+)$/i);
  if (singleMatch) return `https://i.imgur.com/${singleMatch[1]}.png`;

  // Album/gallery pages don't have a single direct image — can't auto-fix
  if (/^https?:\/\/imgur\.com\/(a|gallery)\//i.test(url)) return "";

  return url;
}

function sanitizeGoogleDrive(url) {
  if (!url) return "";
  // Drive share link → direct content link
  // e.g. https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const m = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}

function sanitizeUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";

  // Try known hosts first
  if (u.includes("imgur.com")) u = sanitizeImgur(u);
  if (u.includes("drive.google.com")) u = sanitizeGoogleDrive(u);

  // No protocol? add https
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}


const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function PlayerProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);
  const { user } = useAuth();

  // Branding (school)
  const [branding, setBranding] = useState(null);

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
  const [visibleCount, setVisibleCount] = useState(3);

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

  // simple profanity filter
  const bannedWords = ["faggot", "nigger", "monkey", "nigga", "fuck"];
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
          setPlayer({ id: d.id, ...d.data() });
        }
      } catch (err) {
        console.error("Error fetching player:", err);
      }
    };
    fetchPlayer();
  }, [slug]);

  // Fetch school branding once we know the player's school
  useEffect(() => {
    const fetchBranding = async () => {
      if (!player?.School) {
        setBranding(null);
        return;
      }
      try {
        const sRef = doc(db, "schools", player.School);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          const b = sSnap.data();
          setBranding({
            color1: b.Color1 || SITE_BLUE,
            color2: b.Color2 || SITE_GOLD,
            logo1: b.Logo1 || "",
            logo2: b.Logo2 || "",
          });
        } else {
          setBranding(null);
        }
      } catch (e) {
        console.error("Error loading school branding:", e);
        setBranding(null);
      }
    };
    fetchBranding();
  }, [player]);

  // Derive colors (fallback to site theme)
  const color1 = branding?.color1 || SITE_BLUE;
  const color2 = branding?.color2 || SITE_GOLD;

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

            // only allow into public feed if: evaluation text exists AND no profanity
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
                verified: u.verified || false,
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
              verified: usernameMap[ev.uid]?.verified || false,
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

    // block public saves with profanity
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
// Remove evaluation
async function handleRemoveEvaluation() {
  if (!user || !player?.id) return alert("You must sign in first.");

  const confirmDelete = window.confirm("Remove evaluation from your board?");
  if (!confirmDelete) return;

  try {
    const { deleteDoc, doc } = await import("firebase/firestore");

    await Promise.all([
      deleteDoc(doc(db, "players", player.id, "evaluations", user.uid)),
      deleteDoc(doc(db, "users", user.uid, "evaluations", player.id)),
    ]);

    // Clear local state
    setGrade("");
    setStrengths([]);
    setWeaknesses([]);
    setNflFit("");
    setEvaluation("");
    setVisibility("public");
    setLastUpdated(null);

    alert("🗑️ Evaluation removed from your board.");
  } catch (err) {
    console.error("Error removing evaluation:", err);
    alert("❌ Failed to remove evaluation. Try again.");
  }
}

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
      <div className="flex justify-center items-center h-screen text-xl font-bold" style={{ color: SITE_BLUE }}>
        Loading Player...
      </div>
    );
  }

  return (
  <>
    <Helmet>
      <title>
        {`${player.First || ""} ${player.Last || ""} Draft Scouting Report | We-Draft`}
      </title>

      <meta
        name="description"
        content={`Detailed scouting report, traits, and community evaluations for ${player.First || ""} ${player.Last || ""}, ${player.Position || ""} from ${player.School || ""}.`}
      />

      <meta
        property="og:title"
        content={`${player.First || ""} ${player.Last || ""} Scouting Report`}
      />

      <meta
        property="og:description"
        content={`Draft profile, evaluation, and film for ${player.First || ""} ${player.Last || ""}.`}
      />

      <meta
        property="og:url"
        content={`https://we-draft.com/player/${slug}`}
      />

      <link
        rel="canonical"
        href={`https://we-draft.com/player/${slug}`}
      />
    </Helmet>

    <div className="max-w-6xl mx-auto p-6 pb-40">

      
      {/* ===== Header (logos left/right, info + We-Draft in the middle) ===== */}
<div className="mb-8">
  <div className="flex items-center justify-between gap-6">
    {/* Left logo */}
    <div className="basis-1/3 flex justify-start">
      {branding?.logo1 ? (
        <img
          src={sanitizeUrl(branding.logo1)}
          alt={`${player.School} Logo 1`}
          className="h-40 md:h-48 w-auto object-contain"
          referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          loading="lazy"
        />
      ) : (
        <div className="h-40 md:h-48" />
      )}
    </div>

    {/* Center column: back button, name, position, and We-Draft logo */}
<div className="basis-1/3 flex flex-col items-center text-center">

  {/* Back button */}
  <button
    onClick={() => navigate(-1)}
    className="mb-3 px-4 py-1 text-sm font-semibold rounded-full border-2 transition hover:opacity-90"
    style={{
      backgroundColor: color1,
      borderColor: color2,
      color: "white",
    }}
  >
    Back
  </button>

  <h1 className="text-5xl font-extrabold" style={{ color: color1 }}>
    {`${player.First || ""} ${player.Last || ""}`.toUpperCase()}
  </h1>

  <p className="text-2xl italic font-bold mt-1" style={{ color: color1 }}>
    {`${player.Position || ""} - ${player.School || ""} - ${player.Eligible || ""}`}
  </p>

  {/* We-Draft logo stays BETWEEN the school logos */}
  <img
    src={Logo1}
    alt="We-Draft Logo"
    className="h-16 md:h-20 w-auto object-contain mt-3"
  />
</div>



    {/* Right logo */}
    <div className="basis-1/3 flex justify-end">
      {branding?.logo2 ? (
        <img
          src={sanitizeUrl(branding.logo2)}
          alt={`${player.School} Logo 2`}
          className="h-40 md:h-48 w-auto object-contain"
          referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          loading="lazy"
        />
      ) : (
        <div className="h-40 md:h-48" />
      )}
    </div>
  </div>
</div>

            {/* Measurements Table */}
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full border-collapse text-center">
          <thead>
            <tr style={{ backgroundColor: color1, color: "#fff", border: `4px solid ${color2}` }}>
              {["HT","WT","WING","ARM","HAND","40","VERT","BROAD","3C","SHUTT","BENCH"].map((h) => (
                <th key={h} className="p-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="odd:bg-white even:bg-white hover:bg-[#e6f0fa]">
              {[
                player.Height,
                player.Weight,
                player.Wingspan,
                player["Arm Length"],
                player["Hand Size"],
                player["40 Yard"],
                player.Vertical,
                player.Broad,
                player["3-Cone"],
                player.Shuttle,
                player.Bench,
              ].map((val, i) => (
                <td key={i} className="p-3 text-sm" style={{ border: `1px solid ${color2}` }}>
                  {val || "-"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* 🎥 Film Button */}
      {player.Link && (
        <div className="text-center mb-10">
          <button
            onClick={() => {
              // If Link is an array, open the first link
              if (Array.isArray(player.Link)) {
                window.open(player.Link[0], "_blank", "noopener,noreferrer");
              } else {
                window.open(player.Link, "_blank", "noopener,noreferrer");
              }
            }}
            className="px-6 py-2 font-semibold rounded-full border-2 transition hover:opacity-90"
            style={{
              backgroundColor: color1,
              borderColor: color2,
              color: "white",
            }}
          >
            Film
          </button>
        </div>
      )}


      {/* Community Grades */}
      <div className="mb-10">
        <h2 className="text-3xl font-bold mb-4" style={{ color: color1 }}>
          Community Grades
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Grade */}
          <div className="bg-white rounded-lg shadow text-center border-4" style={{ borderColor: color2 }}>
            <div className="font-bold py-2 rounded-t" style={{ backgroundColor: color1, color: "#fff" }}>
              GRADE
            </div>
            <div className="p-4 text-xl font-bold">
              {community.avgGrade
                ? gradeLabels[Math.round(community.avgGrade)] || "No grade yet"
                : "No grade yet"}
            </div>
          </div>

          {/* Strengths */}
          <div className="bg-white rounded-lg shadow text-center border-4" style={{ borderColor: color2 }}>
            <div className="font-bold py-2 rounded-t" style={{ backgroundColor: color1, color: "#fff" }}>
              STRENGTHS
            </div>
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
          <div className="bg-white rounded-lg shadow text-center border-4" style={{ borderColor: color2 }}>
            <div className="font-bold py-2 rounded-t" style={{ backgroundColor: color1, color: "#fff" }}>
              WEAKNESSES
            </div>
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
          <div className="bg-white rounded-lg shadow text-center border-4" style={{ borderColor: color2 }}>
            <div className="font-bold py-2 rounded-t" style={{ backgroundColor: color1, color: "#fff" }}>
              NFL FIT
            </div>
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
      <div className="bg-white rounded-lg p-6 shadow mb-10 border-4" style={{ borderColor: color2 }}>
        <h2
  className="text-4xl md:text-5xl font-extrabold text-center mb-1 tracking-wide"
  style={{ color: color1 }}
>
  {`${player.First || ""} ${player.Last || ""}`.toUpperCase()}
</h2>

        <h2 className="text-2xl font-bold text-center mb-2" style={{ color: color1 }}>
  My Evaluation
</h2>

{/* Smaller We-Draft logo above Grade */}
<div className="flex flex-col items-center mb-3">
  <img
    src={Logo1}
    alt="We-Draft Logo"
    className="h-10 md:h-12 w-auto object-contain mb-1 opacity-90"
  />
  
</div>



        {!user ? (
          <p className="text-center font-semibold" style={{ color: "#dc2626" }}>
            Please sign in to submit an evaluation.
          </p>
        ) : (
          <>
            {/* Grade */}
            <label className="block font-semibold mb-2">Grade</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded px-3 py-2 mb-4 border-2"
              style={{ borderColor: color1 }}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* Strengths */}
              <div>
                <label className="block font-semibold mb-2">Strengths (max 5)</label>
                <details className="w-full rounded border-2" style={{ borderColor: color1 }}>
                  <summary className="cursor-pointer px-3 py-2 bg-white">
                    {strengths.length > 0 ? strengths.join(", ") : "Select strengths"}
                  </summary>
                  <div className="max-h-40 overflow-y-auto px-3 py-2 bg-white">
                    {Object.entries(traits).map(([label, options]) => (
                      <div key={label} className="mb-2">
                        <p className="font-bold" style={{ color: color1 }}>{label}</p>
                        {options.map((trait) => (
                          <label key={trait} className="block text-sm">
                            <input
                              type="checkbox"
                              checked={strengths.includes(trait)}
                              disabled={
                                (!strengths.includes(trait) && strengths.length >= 5) ||
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
                <label className="block font-semibold mb-2">Weaknesses (max 5)</label>
                <details className="w-full rounded border-2" style={{ borderColor: color1 }}>
                  <summary className="cursor-pointer px-3 py-2 bg-white">
                    {weaknesses.length > 0 ? weaknesses.join(", ") : "Select weaknesses"}
                  </summary>
                  <div className="max-h-40 overflow-y-auto px-3 py-2 bg-white">
                    {Object.entries(traits).map(([label, options]) => (
                      <div key={label} className="mb-2">
                        <p className="font-bold" style={{ color: color1 }}>{label}</p>
                        {options.map((trait) => (
                          <label key={trait} className="block text-sm">
                            <input
                              type="checkbox"
                              checked={weaknesses.includes(trait)}
                              disabled={
                                (!weaknesses.includes(trait) && weaknesses.length >= 5) ||
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
              className="w-full rounded px-3 py-2 mb-4 border-2"
              style={{ borderColor: color1 }}
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
              className="w-full rounded px-3 py-2 h-32 mb-4 border-2"
              style={{ borderColor: color1 }}
            />

            {/* Visibility */}
            <label className="block font-semibold mb-2">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="w-full rounded px-3 py-2 mb-4 border-2"
              style={{ borderColor: color1 }}
            >
              <option value="public">🌍 Public</option>
              <option value="private">🔒 Private</option>
            </select>

            <button
  onClick={handleSaveEvaluation}
  disabled={saving}
  className="w-full text-white font-bold py-2 rounded border-2 transition"
  style={{ backgroundColor: color1, borderColor: color2 }}
>
  {saving ? "Saving..." : "Save Evaluation"}
</button>

{lastUpdated && (
  <button
    onClick={handleRemoveEvaluation}
    className="mt-2 w-full text-xs text-gray-400 hover:text-red-500 font-medium underline transition"
  >
    Remove from Board
  </button>
)}

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
        <h2 className="text-3xl font-bold mb-4" style={{ color: color1 }}>
          🌍 Public Evaluations
        </h2>
        {publicFeed.length > 0 ? (
          <>
            {publicFeed.slice(0, visibleCount).map((ev) => (
              <div
                key={ev.uid}
                className="bg-white rounded-lg p-4 mb-4 shadow border-4"
                style={{ borderColor: color2 }}
              >
                <p className="font-bold flex items-center" style={{ color: color1 }}>
                  {ev.username}
                  {ev.verified && (
                    <img
                      src={verifiedBadge}
                      alt="Verified"
                      className="ml-2 w-5 h-5 inline-block"
                    />
                  )}
                </p>
                <p className="font-bold text-black">
                  {`${player.First || ""} ${player.Last || ""}`.toUpperCase()}
                </p>
                <p className="mb-2">
                  <span className="font-bold">Grade:</span>{" "}
                  <span className="font-bold">{ev.grade || "N/A"}</span>
                </p>
                {ev.strengths?.length > 0 && (
                  <p>
                    <span className="font-semibold">Strengths:</span>{" "}
                    {ev.strengths.join(", ")}
                  </p>
                )}
                {ev.weaknesses?.length > 0 && (
                  <p>
                    <span className="font-semibold">Weaknesses:</span>{" "}
                    {ev.weaknesses.join(", ")}
                  </p>
                )}
                {ev.nflFit && (
                  <p>
                    <span className="font-semibold">NFL Fit:</span> {ev.nflFit}
                  </p>
                )}
                {ev.evaluation && <p className="italic mt-2">"{ev.evaluation}"</p>}
                {ev.updatedAt && (
                  <p className="text-xs text-gray-500 mt-3">
                    {renderDate(ev.updatedAt)}
                  </p>
                )}
              </div>
            ))}

            {visibleCount < publicFeed.length && (
              <button
                onClick={() => setVisibleCount((prev) => prev + 3)}
                className="w-full text-white font-bold py-2 rounded border-2 transition"
                style={{ backgroundColor: color1, borderColor: color2 }}
              >
                Show More
              </button>
            )}
          </>
        ) : (
          <p className="italic text-gray-500">No public evaluations yet.</p>
        )}
      </div>
        </div>
  </>
);
}