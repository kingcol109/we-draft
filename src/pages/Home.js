// src/pages/Home.js
import { useEffect, useState } from "react";
import { getDoc, doc, getDocs, collection, query, where } from "firebase/firestore";
import { db } from "../firebase";
import logo from "../assets/Logo1.png";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const { user, login } = useAuth();

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
          // Try by document ID
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

          // Try by Slug field
          try {
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
          } catch (_) {}

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

  // Today's date: "October 10, 2025"
  const formattedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="bg-white text-[#0055a5] min-h-screen flex flex-col items-center pt-12 px-4">
      {/* Logo */}
<img
  src={logo}
  alt="We-Draft Logo"
  className="w-[360px] md:w-[460px] max-w-[95vw] h-auto mb-4"
/>

{/* Tagline */}
<p className="text-xl md:text-2xl font-semibold text-[#0055a5] mb-6">
  <Link
    to="/boards"
    className="text-[#f6a21d] underline hover:text-[#d88f18] transition"
  >
    Create + Store
  </Link>{" "}
  your own evaluations and view{" "}
  <Link
    to="/community"
    className="text-[#f6a21d] underline hover:text-[#d88f18] transition"
  >
    Community Grades
  </Link>
  !
</p>


{/* Auth Button or Welcome Message */}

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
          Login/Create an account to create and store your own evaluations
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

      {/* Featured Players Section */}
      <div className="bg-white border-4 border-[#f6a21d] rounded-2xl shadow-lg p-10 mb-16 w-full max-w-5xl">
        {/* Centered date + label */}
        <h2 className="text-4xl md:text-5xl font-extrabold text-[#0055a5] mb-1 uppercase tracking-wide text-center">
          {formattedDate}
        </h2>
        <h3 className="text-2xl md:text-3xl font-extrabold text-[#f6a21d] mb-6 text-center">
          FEATURED PLAYERS
        </h3>

        {featured.length > 0 ? (
          <ul className="flex flex-col items-center space-y-1 md:space-y-2">
            {featured.map((p, idx) => {
              const isTop3 = idx < 3;
              return (
                <li key={p.id} className="w-full max-w-3xl">
                  <Link
                    to={`/player/${p.slug}`}
                    className={`block text-center transition hover:bg-[#e6f0fa] rounded-lg px-4 ${
                      isTop3
                        ? "py-2 text-2xl md:text-3xl font-extrabold"
                        : "py-1 text-xl md:text-2xl font-bold"
                    }`}
                  >
                    <span
                      className={`mr-2 font-black ${
                        isTop3 ? "text-[#f6a21d]" : ""
                      }`}
                    >
                      {idx + 1}.
                    </span>
                    {`${p.first} ${p.last} - ${p.school} ${p.position} ${
                      p.eligible ? `(${p.eligible})` : ""
                    }`}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="italic text-gray-500 text-lg text-center">No featured players set yet.</p>
        )}
      </div>

      {/* Promo Section */}
      <div className="grid md:grid-cols-3 gap-10 w-full max-w-6xl mb-16">
        <Link
          to="/community"
          className="bg-white border-4 border-[#f6a21d] rounded-xl shadow hover:shadow-xl transition p-8 block"
        >
          <h2 className="text-2xl font-bold mb-4 text-[#0055a5]">Community Boards</h2>
          <p className="text-base">
            See what the public thinks about the best players in the country.
          </p>
        </Link>

        <Link
          to="/boards"
          className="bg-white border-4 border-[#f6a21d] rounded-xl shadow hover:shadow-xl transition p-8 block"
        >
          <h2 className="text-2xl font-bold mb-4 text-[#0055a5]">My Boards</h2>
          <p className="text-base">
            Create and store all your evaluations in one place.
          </p>
        </Link>

        <Link
          to="/community"
          className="bg-white border-4 border-[#f6a21d] rounded-xl shadow hover:shadow-xl transition p-8 block"
        >
          <h2 className="text-2xl font-bold mb-4 text-[#0055a5]">Player Profiles</h2>
          <p className="text-base">
            Dive deep into player evaluations with measurables, strengths,
            weaknesses, and community feedback — all in one place.
          </p>
        </Link>
      </div>

      {/* Future Promo Block */}
      <div className="bg-[#0055a5] text-white rounded-2xl p-10 max-w-5xl w-full shadow-md mb-16">
        <h2 className="text-3xl md:text-4xl font-extrabold mb-4 text-[#f6a21d]">
          🚀 Coming Soon
        </h2>
        <p className="text-lg md:text-xl">
          Exclusive draft content, highlight videos, and featured fan
          submissions will be showcased here. Stay tuned!
        </p>
      </div>
    </div>
  );
}
