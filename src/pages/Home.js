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
          ? cfg.playerIds.slice(0, 5)
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
      const headlinesRef = collection(db, "headlines");

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
          className="w-[420px] md:w-[720px] max-w-[95vw] h-auto mb-4"
        />

        {/* Auth */}
        {!user ? (
          <button
            onClick={login}
            className="bg-[#0055a5] text-white px-6 py-3 rounded-lg font-semibold text-lg shadow hover:bg-[#004080] transition mb-12"
          >
            Login with Google to create and store your own evaluations!
          </button>
        ) : (
          <p className="text-lg md:text-xl max-w-2xl mb-12 font-medium text-center">
            Welcome back! Head over to{" "}
            <Link to="/boards" className="underline">
              My Boards
            </Link>
            .
          </p>
        )}

        
        {/* Featured Players */}
        <div className="p-10 mb-16 w-full max-w-6xl">
          <h2 className="text-4xl md:text-5xl font-extrabold text-[#0055a5] mb-1 uppercase tracking-wide text-center">
            {formattedDate}
          </h2>
          <h3 className="text-2xl md:text-3xl font-extrabold text-[#f6a21d] mb-10 text-center">
            FEATURED PLAYERS
          </h3>

          {featured.length > 0 ? (
  <div className="flex flex-col items-center gap-12">
    {/* Top row — 2 featured (bigger) */}
    <div className="flex justify-center gap-12">
      {featured.slice(0, 2).map((p) => (
        <Link key={p.id} to={`/player/${p.slug}`}>
          <img
            src={p.imageUrl || "/placeholders/player-card.png"}
            alt="Featured Player"
            className="
              w-[300px]
              h-auto
              object-contain
              rounded-xl
              shadow-2xl
              transition
              hover:scale-105
            "
            loading="lazy"
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
            className="
              w-[240px]
              h-auto
              object-contain
              rounded-xl
              shadow-xl
              transition
              hover:scale-105
            "
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = "/placeholders/player-card.png";
            }}
          />
        </Link>
      ))}
    </div>
  </div>
) : (
  <p className="italic text-gray-500 text-lg text-center">
    No featured players set yet.
  </p>
)}

        </div>
{/* 📰 News Feed */}
{news.length > 0 && (
  <div className="w-full max-w-5xl mb-20">
    <div className="flex items-center justify-between mb-4">
      <h2
        className="text-3xl font-extrabold tracking-wide"
        style={{ color: SITE_BLUE }}
      >
        NEWS
      </h2>
    </div>

    <div className="bg-white border border-[#e0e8f5] rounded-xl shadow-sm divide-y">
      {news.map((n) => (
        <div key={n.id} className="p-4 hover:bg-[#f9fbff] transition">
          <a
            href={n.Url || "#"}
            target={n.Url ? "_blank" : "_self"}
            rel="noopener noreferrer"
            className="font-semibold text-[#0055a5] hover:underline block"
          >
            {n.Title}
          </a>

          <div className="text-xs text-gray-500 mt-1 flex gap-2">
            {n.Source && <span>{n.Source}</span>}
            {n.publishedAt && (
              <span>
                ·{" "}
                {n.publishedAt.toDate().toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
      ))}

      {/* Show More */}
      <div className="p-4 text-center bg-[#f9fbff]">
        <button
          className="font-semibold text-[#0055a5] hover:underline"
          onClick={() => {
            // TODO: route to /news
            console.log("Go to full news page");
          }}
        >
          Show more →
        </button>
      </div>
    </div>
  </div>
)}

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

                    {ev.evaluation && (
                      <p className="italic text-gray-800 mt-2">"{ev.evaluation}"</p>
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
