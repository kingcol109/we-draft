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
import logo from "../assets/outlinelogo.png";
import verifiedBadge from "../assets/verified.png";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Helmet } from "react-helmet-async";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const [recentEvals, setRecentEvals] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user, login } = useAuth();

  /* =========================
     Fetch featured players (slug-only)
     ========================= */
  useEffect(() => {
    const fetchFeatured = async () => {
      try {
        const cfgSnap = await getDoc(doc(db, "config", "featured"));
        if (!cfgSnap.exists()) {
          setFeatured([]);
          return;
        }

        const cfg = cfgSnap.data() || {};
        const slugs = Array.isArray(cfg.playerIds)
          ? cfg.playerIds.slice(0, 10)
          : [];

        if (!slugs.length) {
          setFeatured([]);
          return;
        }

        const playersCol = collection(db, "players");

        const players = (
          await Promise.all(
            slugs.map(async (slug) => {
              const q = query(playersCol, where("Slug", "==", slug), limit(1));
              const snap = await getDocs(q);
              if (snap.empty) return null;

              const d = snap.docs[0];
              const p = d.data();

              return {
  id: d.id,
  slug: p.Slug,
  imageUrl: p.imageUrl || null,
  name: `${p.First || ""} ${p.Last || ""}`.trim(),
  position: p.Position || "",
  school: p.School || "",
};

            })
          )
        ).filter(Boolean);

        setFeatured(players);
      } catch (err) {
        console.error("Error fetching featured players:", err);
        setFeatured([]);
      }
    };

    fetchFeatured();
  }, []);
useEffect(() => {
  const fetchNews = async () => {
    try {
      const headlinesRef = collection(db, "news");

      // 1) Can we read ANY docs from the collection?
      const allSnap = await getDocs(headlinesRef);
      console.log("ALL HEADLINES DOCS:", allSnap.size);
      console.log(
        "ALL HEADLINES SAMPLE:",
        allSnap.docs.slice(0, 5).map((d) => ({ id: d.id, ...d.data() }))
      );

      // 2) Now test your real query
      const qRef = query(
        headlinesRef,
        where("active", "==", true),
        orderBy("publishedAt", "desc"),
        limit(5)
      );

      const snap = await getDocs(qRef);
      console.log("FILTERED NEWS DOCS:", snap.size);
      console.log(
        "FILTERED NEWS:",
        snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      );

      setNews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Error fetching news:", err);
    }
  };

  fetchNews();
}, []);

  /* =========================
     Fetch recent evaluations
     ========================= */
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
          .filter((e) => e.visibility === "public" && e.evaluation?.trim())
          .sort((a, b) => {
            const aTime = a.updatedAt?.toDate?.()?.getTime?.() || 0;
            const bTime = b.updatedAt?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
          })
          .slice(0, 10);

        const uniqueUids = [...new Set(publicEvals.map((ev) => ev.uid))];
        const userDocs = await Promise.all(
          uniqueUids.map((uid) => getDoc(doc(db, "users", uid)))
        );

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

        setRecentEvals(
          publicEvals.map((ev) => ({
            ...ev,
            username: userMap[ev.uid]?.username || "User",
            verified: userMap[ev.uid]?.verified || false,
          }))
        );
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

      <div className="bg-white text-[#0055a5] min-h-screen flex flex-col items-center pt-8 px-4">
        {/* Logo */}
        <img
          src={logo}
          alt="We-Draft Logo"
          className="w-[420px] md:w-[720px] max-w-[95vw] h-auto mb-0"
        />

        {/* Auth */}
        {!user ? (
          <button
            onClick={login}
            className="bg-[#0055a5] text-white px-6 py-3 rounded-lg font-semibold text-lg shadow hover:bg-[#004080] transition mb-0"
          >
            Login with Google to create and store your own evaluations!
          </button>
        ) : (
          <p className="text-lg md:text-xl max-w-2xl mb-2 font-medium text-center">
            Welcome back! Head over to{" "}
            <Link to="/boards" className="underline">
              My Boards
            </Link>
            .
          </p>
        )}

        
        {/* Featured Players + Social Box */}
<div className="mb-16 w-full max-w-7xl relative">

  {/* Social Follow Box (does NOT affect centering) */}
  <div className="hidden lg:block absolute left-0 top-6 w-[260px]">
    <div className="bg-[#f9fbff] border-2 border-[#e0e8f5] rounded-xl px-6 pt-6 pb-4 shadow-sm">
      <p
        className="text-2xl font-extrabold leading-snug text-center mb-4"
        style={{ color: SITE_BLUE }}
      >
        Follow us on social media for draft content and website updates & developments!
      </p>

      <ul className="space-y-4 text-3xl font-bold text-center">
        <li>
          <a
            href="https://www.instagram.com/wedraftsite"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[#f6a21d] hover:underline"
          >
            Instagram
          </a>
        </li>

        <li>
          <a
            href="https://twitter.com/wedraftsite"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[#f6a21d] hover:underline"
          >
            X (Twitter)
          </a>
        </li>

        <li>
          <a
            href="https://www.youtube.com/@kingcoldsports"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[#f6a21d] hover:underline"
          >
            YouTube
          </a>
        </li>
      </ul>
    </div>
  </div>
{/* News Feed Box (RIGHT SIDE) */}
<div className="hidden lg:block absolute right-0 top-6 w-[300px]">
  <div
    className="bg-white rounded-xl shadow-sm border-4"
    style={{ borderColor: SITE_GOLD }}
  >
    {/* Header */}
    <div
      className="px-4 py-3 rounded-t-lg text-center font-extrabold text-lg uppercase"
      style={{ backgroundColor: SITE_BLUE, color: "white" }}
    >
      News
    </div>

    {/* Body */}
    <div className="divide-y">
      {news.length > 0 ? (
        news.map((n) => (
          <div key={n.id} className="p-4 hover:bg-[#f9fbff] transition">
           {n.long && n.slug ? (
  <Link
    to={`/news/${n.slug}`}
    className="font-bold text-sm hover:underline leading-snug"
    style={{ color: SITE_BLUE }}
  >
    <span className="mr-1 font-extrabold">
      {n.publishedAt
        ?.toDate?.()
        .toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      :
    </span>
    {n.title}
  </Link>
) : (
  <div className="font-bold text-sm text-gray-500 leading-snug">
    <span className="mr-1 font-extrabold">
      {n.publishedAt
        ?.toDate?.()
        .toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      :
    </span>
    {n.title}
  </div>
)}

          </div>
        ))
      ) : (
        <p className="p-4 italic text-gray-500 text-sm text-center">
          No news available
        </p>
      )}
    </div>

    {/* Footer */}
    <div className="p-3 text-center bg-[#f9fbff] rounded-b-lg">
      <Link
  to="/news"
  className="text-lg font-extrabold uppercase hover:underline"
  style={{ color: SITE_BLUE }}
>
  Show More
</Link>

    </div>
  </div>
</div>

  {/* Featured Players (stays centered) */}
  <div className="w-full flex justify-center">
    <div className="w-full max-w-6xl p-10">

      <h2 className="text-4xl md:text-5xl font-extrabold text-[#0055a5] mb-1 uppercase tracking-wide text-center">
        {formattedDate}
      </h2>

      <h3 className="text-2xl md:text-3xl font-extrabold text-[#f6a21d] mb-10 text-center">
        FEATURED PLAYERS
      </h3>

      {featured.length > 0 ? (
        <div className="flex flex-col items-center gap-12">

          {/* Top row — 2 featured */}
          <div className="flex justify-center gap-12">
            {featured.slice(0, 2).map((p) => (
              <Link key={p.id} to={`/player/${p.slug}`}>
                <img
                  src={p.imageUrl || "/placeholders/player-card.png"}
                  alt="Featured Player"
                  className="w-[300px] h-auto object-contain rounded-xl shadow-2xl hover:scale-105 transition"
                  onError={(e) => {
                    e.currentTarget.src = "/placeholders/player-card.png";
                  }}
                />
              </Link>
            ))}
          </div>

          {/* Bottom row — 3 featured */}
          <div className="flex justify-center gap-10">
            {featured.slice(2, 5).map((p) => (
              <Link key={p.id} to={`/player/${p.slug}`}>
                <img
                  src={p.imageUrl || "/placeholders/player-card.png"}
                  alt="Featured Player"
                  className="w-[240px] h-auto object-contain rounded-xl shadow-xl hover:scale-105 transition"
                  onError={(e) => {
                    e.currentTarget.src = "/placeholders/player-card.png";
                  }}
                />
              </Link>
            ))}
          </div>
{/* Also Featured (6–10) */}
{featured.length > 5 && (
  <div className="mt-6 w-full max-w-4xl text-center">
    <h4
      className="text-3xl font-extrabold mb-2 uppercase tracking-wide"
      style={{ color: SITE_BLUE }}
    >
      Also Featured This Week
    </h4>

    <ul className="space-y-3">
      {featured.slice(5, 10).map((p) => (
        <li key={p.id}>
          <Link
            to={`/player/${p.slug}`}
            className="
              text-2xl
              font-bold
              hover:underline
              transition
            "
            style={{ color: SITE_GOLD }}
          >
            {p.name} · {p.position} · {p.school}
          </Link>
        </li>
      ))}
    </ul>
  </div>
)}


        </div>
      ) : (
        <p className="italic text-gray-500 text-lg text-center">
          No featured players set yet.
        </p>
      )}
    </div>
  </div>
</div>

        {/* Recent Evaluations (unchanged) */}
        <div className="w-full max-w-5xl mb-16">
          <h2 className="text-3xl font-extrabold mb-6" style={{ color: SITE_BLUE }}>
            🌍 Recent Evaluations
          </h2>

          {loading ? (
            <p className="text-gray-500 italic text-center">Loading recent evaluations...</p>
          ) : recentEvals.length ? (
            <div className="bg-[#f9fbff] border-2 border-[#e0e8f5] rounded-xl p-4">
              <div className="flex flex-col gap-6 overflow-y-auto pr-2" style={{ maxHeight: "700px" }}>
                {recentEvals.map((ev, i) => (
                  <div
                    key={i}
                    className="bg-white border-4 rounded-xl shadow p-4 md:p-6"
                    style={{ borderColor: SITE_GOLD }}
                  >
                    <p className="font-bold flex items-center mb-1 text-lg" style={{ color: SITE_BLUE }}>
                      {ev.username}
                      {ev.verified && (
                        <img src={verifiedBadge} alt="Verified" className="ml-2 w-5 h-5" />
                      )}
                    </p>

                    <Link
                      to={`/player/${ev.playerSlug}`}
                      className="font-extrabold text-lg uppercase text-[#0055a5] underline"
                    >
                      {ev.playerName}
                    </Link>

                    {/* Grade */}
{ev.grade && (
  <p className="mt-2 font-semibold text-black">
    Grade: {ev.grade}
  </p>
)}

{/* Strengths */}
{ev.strengths && (
  <p className="mt-1 text-black">
    <span className="font-semibold">Strengths:</span>{" "}
    {Array.isArray(ev.strengths)
      ? ev.strengths.join(", ")
      : ev.strengths
          .replace(/([a-z])([A-Z])/g, "$1, $2")}
  </p>
)}

{/* Weaknesses */}
{ev.weaknesses && (
  <p className="mt-1 text-black">
    <span className="font-semibold">Weaknesses:</span>{" "}
    {Array.isArray(ev.weaknesses)
      ? ev.weaknesses.join(", ")
      : ev.weaknesses
          .replace(/([a-z])([A-Z])/g, "$1, $2")}
  </p>
)}


{/* NFL Fit */}
{ev.nflFit && (
  <p className="mt-1 text-black">
    <span className="font-semibold">NFL Fit:</span> {ev.nflFit}
  </p>
)}

{/* Main Evaluation Text */}
{ev.evaluation && (
  <p className="italic text-gray-800 mt-3">
    "{ev.evaluation}"
  </p>
)}

                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-center italic text-gray-500">No recent evaluations yet.</p>
          )}
        </div>
      </div>
    </>
  );
}
