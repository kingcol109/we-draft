import { useEffect, useState } from "react";
import {
  getDoc,
  doc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../firebase";
import logo from "../assets/Logo1.png";
import verifiedBadge from "../assets/verified.png";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Helmet } from "react-helmet";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const [recentEvals, setRecentEvals] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user, login } = useAuth();

  // 🧩 Fetch featured players
  useEffect(() => {
    const fetchFeatured = async () => {
      try {
        const cfgSnap = await getDoc(doc(db, "config", "featured"));
        if (!cfgSnap.exists()) {
          setFeatured([]);
          return;
        }

        const cfg = cfgSnap.data() || {};
        const idsOrSlugs = Array.isArray(cfg.playerIds) ? cfg.playerIds.slice(0, 10) : [];

        const getPlayer = async (idOrSlug) => {
          try {
            const byId = await getDoc(doc(db, "players", idOrSlug));
            if (byId.exists()) {
              const p = byId.data();
              return {
                id: byId.id,
                slug: p.Slug || byId.id,
                first: p.First || "",
                last: p.Last || "",
                position: p.Position || "-",
                school: p.School || "-",
                eligible: p.Eligible || "",
              };
            }
          } catch (_) {}

          const q = query(collection(db, "players"), where("Slug", "==", idOrSlug));
          const res = await getDocs(q);
          if (!res.empty) {
            const snap = res.docs[0];
            const p = snap.data();
            return {
              id: snap.id,
              slug: p.Slug || snap.id,
              first: p.First || "",
              last: p.Last || "",
              position: p.Position || "-",
              school: p.School || "-",
              eligible: p.Eligible || "",
            };
          }

          return null;
        };

        const players = (await Promise.all(idsOrSlugs.map(getPlayer))).filter(Boolean);
        setFeatured(players);
      } catch (err) {
        console.error("Error fetching featured players:", err);
        setFeatured([]);
      }
    };

    fetchFeatured();
  }, []);

  // 🧩 Fetch recent evaluations
  useEffect(() => {
    const fetchRecentEvals = async () => {
      try {
        const playersSnap = await getDocs(collection(db, "players"));
        const evalPromises = [];

        playersSnap.forEach((playerDoc) => {
          const evalsRef = collection(db, "players", playerDoc.id, "evaluations");
          const q = query(evalsRef, orderBy("updatedAt", "desc"), limit(2));
          evalPromises.push(
            getDocs(q).then((snap) =>
              snap.docs.map((d) => {
                const playerData = playerDoc.data();
                return {
                  ...d.data(),
                  playerId: playerDoc.id,
                  playerName: `${playerData.First || ""} ${playerData.Last || ""}`.trim(),
                  playerSlug: playerData.Slug || playerDoc.id,
                };
              })
            )
          );
        });

        const results = await Promise.all(evalPromises);
        const allEvals = results.flat();

        const publicEvals = allEvals
          .filter((e) => e.visibility === "public" && e.evaluation?.trim() !== "")
          .sort((a, b) => {
            const aTime = a.updatedAt?.toDate?.()?.getTime?.() || 0;
            const bTime = b.updatedAt?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
          })
          .slice(0, 10);

        const uniqueUids = [...new Set(publicEvals.map((ev) => ev.uid))];
        const userDocs = await Promise.all(uniqueUids.map((uid) => getDoc(doc(db, "users", uid))));
        const userMap = {};
        userDocs.forEach((snap) => {
          if (snap.exists()) {
            const u = snap.data();
            userMap[snap.id] = {
              username: u.username || u.email || "User",
              verified: u.verified || false,
            };
          }
        });

        const withNames = publicEvals.map((ev) => ({
          ...ev,
          username: userMap[ev.uid]?.username || "User",
          verified: userMap[ev.uid]?.verified || false,
        }));

        setRecentEvals(withNames);
      } catch (err) {
        console.error("Error fetching recent evaluations:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentEvals();
  }, []);

  const formattedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <Helmet>
        <title>We-Draft.com</title>
      </Helmet>

      <div className="bg-white text-[#0055a5] min-h-screen flex flex-col items-center pt-12 px-4">
        {/* Logo */}
        <img src={logo} alt="We-Draft Logo" className="w-[360px] md:w-[460px] max-w-[95vw] h-auto mb-4" />

        {/* Tagline */}
        <p className="text-xl md:text-2xl font-semibold text-[#0055a5] mb-6">
          <Link to="/boards" className="text-[#f6a21d] underline hover:text-[#d88f18] transition">
            Create + Store
          </Link>{" "}
          your own evaluations and view{" "}
          <Link to="/community" className="text-[#f6a21d] underline hover:text-[#d88f18] transition">
            Community Grades
          </Link>
          !
        </p>

        {/* Auth Section */}
        {!user ? (
          <button
            onClick={async () => {
              try {
                await login();
              } catch (err) {
                console.error("Login failed:", err);
              }
            }}
            className="bg-[#0055a5] text-white px-6 py-3 rounded-lg font-semibold text-lg shadow hover:bg-[#004080] transition mb-12"
          >
            Login with Google to create and store your own evaluations
          </button>
        ) : (
          <p className="text-lg md:text-xl max-w-2xl mb-12 font-medium text-center">
            Welcome back! Head over to{" "}
            <Link to="/boards" className="underline">
              My Boards
            </Link>{" "}
            to manage your evaluations.
          </p>
        )}

        {/* Featured Players */}
        <div className="bg-white border-4 border-[#f6a21d] rounded-2xl shadow-lg p-10 mb-16 w-full max-w-5xl">
          <h2 className="text-4xl md:text-5xl font-extrabold text-[#0055a5] mb-1 uppercase tracking-wide text-center">
            {formattedDate}
          </h2>
          <h3 className="text-2xl md:text-3xl font-extrabold text-[#f6a21d] mb-6 text-center">
            FEATURED PLAYERS
          </h3>

          {featured.length > 0 ? (
            <ul className="flex flex-col items-center space-y-1 md:space-y-2">
              {featured.map((p, idx) => (
                <li key={p.id} className="w-full max-w-3xl">
                  <Link
                    to={`/player/${p.slug}`}
                    className={`block text-center transition hover:bg-[#e6f0fa] rounded-lg px-4 ${
                      idx < 3
                        ? "py-2 text-2xl md:text-3xl font-extrabold"
                        : "py-1 text-xl md:text-2xl font-bold"
                    }`}
                  >
                    <span className={`mr-2 font-black ${idx < 3 ? "text-[#f6a21d]" : ""}`}>
                      {idx + 1}.
                    </span>
                    {`${p.first} ${p.last} - ${p.school} ${p.position} ${
                      p.eligible ? `(${p.eligible})` : ""
                    }`}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="italic text-gray-500 text-lg text-center">
              No featured players set yet.
            </p>
          )}
        </div>

        {/* 🌍 Recent Evaluations */}
<div className="w-full max-w-5xl mb-16">
  <h2
    className="text-3xl font-extrabold mb-6 flex items-center gap-2"
    style={{ color: SITE_BLUE }}
  >
    🌍 Recent Evaluations
  </h2>

  {loading ? (
    <p className="text-gray-500 italic text-center">
      Loading recent evaluations...
    </p>
  ) : recentEvals.length > 0 ? (
    <div className="bg-[#f9fbff] border-2 border-[#e0e8f5] rounded-xl p-4">
      <div
        className="flex flex-col gap-6 overflow-y-auto pr-2"
        style={{ maxHeight: "700px" }}
      >
        {recentEvals.map((ev, i) => (
          <div
            key={i}
            className="bg-white border-4 rounded-xl shadow p-4 md:p-6"
            style={{ borderColor: SITE_GOLD }}
          >
            <p
              className="font-bold flex items-center mb-1 text-lg"
              style={{ color: SITE_BLUE }}
            >
              {ev.username}
              {ev.verified && (
                <img
                  src={verifiedBadge}
                  alt="Verified"
                  className="ml-2 w-5 h-5 inline-block"
                />
              )}
            </p>

            <Link
              to={`/player/${ev.playerSlug}`}
              className="font-extrabold text-lg uppercase mb-1 text-[#0055a5] hover:text-[#f6a21d] transition underline"
            >
              {ev.playerName}
            </Link>

            <p className="font-semibold mb-1">
              Grade: <span className="font-bold">{ev.grade || "N/A"}</span>
            </p>

            {ev.strengths?.length > 0 && (
              <p className="text-sm mb-1">
                <span className="font-semibold">Strengths:</span>{" "}
                {ev.strengths.join(", ")}
              </p>
            )}

            {ev.weaknesses?.length > 0 && (
              <p className="text-sm mb-1">
                <span className="font-semibold">Weaknesses:</span>{" "}
                {ev.weaknesses.join(", ")}
              </p>
            )}

            {ev.nflFit && (
              <p className="text-sm mb-1">
                <span className="font-semibold">NFL Fit:</span> {ev.nflFit}
              </p>
            )}

            {ev.evaluation && (
              <p className="italic text-gray-800 mt-2">
                "{ev.evaluation}"
              </p>
            )}

            {ev.updatedAt && (
              <p className="text-xs text-gray-500 mt-3">
                {ev.updatedAt?.toDate?.()?.toLocaleString?.() || ""}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  ) : (
    <p className="text-center italic text-gray-500">
      No recent evaluations yet.
    </p>
  )}
</div>


        {/* Coming Soon */}
        <div className="bg-[#0055a5] text-white rounded-2xl p-10 max-w-5xl w-full shadow-md mb-16">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4 text-[#f6a21d]">
            🚀 Coming Soon
          </h2>
          <p className="text-lg md:text-xl">
            Exclusive draft content, highlight videos, and featured fan submissions will be showcased here. Stay tuned!
          </p>
        </div>
      </div>
    </>
  );
}
