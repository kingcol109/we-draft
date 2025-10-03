// src/pages/Home.js
import { useEffect, useState } from "react";
import { collectionGroup, getDocs, getDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import logo from "../assets/Logo1.png";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext"; // ✅ auth hook

export default function Home() {
  const [trending, setTrending] = useState([]);
  const { user, login } = useAuth(); // ✅ bring in auth

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const snap = await getDocs(collectionGroup(db, "evaluations"));
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const counts = {};

        snap.forEach((d) => {
          const data = d.data();
          let ts = null;
          if (data.updatedAt?.toDate) {
            ts = data.updatedAt.toDate().getTime();
          } else if (typeof data.updatedAt === "number") {
            ts = data.updatedAt;
          } else {
            ts = Date.now();
          }

          if (ts < oneWeekAgo) return;

          const pid = data.playerId;
          if (!pid) return;
          counts[pid] = (counts[pid] || 0) + 1;
        });

        // top 3
        const topIds = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([id]) => id);

        const playersData = await Promise.all(
          topIds.map(async (pid) => {
            try {
              const snap = await getDoc(doc(db, "players", pid));
              if (snap.exists()) {
                const p = snap.data();
                return {
                  id: pid,
                  slug: p.Slug,
                  name: `${p.First || ""} ${p.Last || ""}`.trim(),
                  position: p.Position || "-",
                  school: p.School || "-",
                };
              }
            } catch (err) {
              console.error("Error fetching player:", pid, err);
            }
            return null;
          })
        );

        setTrending(playersData.filter(Boolean));
      } catch (err) {
        console.error("Error fetching trending players:", err);
      }
    };

    fetchTrending();
  }, []);

  return (
    <div className="bg-white text-[#0055a5] min-h-screen flex flex-col items-center text-center pt-12 px-4">
      {/* Logo */}
      <img
        src={logo}
        alt="We-Draft Logo"
        className="w-[340px] md:w-[440px] max-w-[95vw] h-auto mb-6"
      />

      {/* Auth Button or Welcome Message */}
      {!user ? (
        <button
          onClick={async () => {
            try {
              await login(); // ✅ same as navbar
            } catch (err) {
              console.error("Login failed:", err);
            }
          }}
          className="bg-[#0055a5] text-white px-6 py-3 rounded-lg font-semibold text-lg shadow hover:bg-[#004080] transition mb-12"
        >
          Login/Create an account to create and store your own evaluations
        </button>
      ) : (
        <p className="text-lg md:text-xl max-w-2xl mb-12 font-medium">
          Welcome back! Head over to{" "}
          <Link to="/boards" className="underline">
            My Boards
          </Link>{" "}
          to manage your evaluations.
        </p>
      )}

      {/* Trending Players */}
      <div className="bg-white border-4 border-[#f6a21d] rounded-lg shadow p-6 mb-12 w-full max-w-3xl">
        <h2 className="text-3xl font-bold text-[#0055a5] mb-6">
          🔥 Trending Players
        </h2>
        {trending.length > 0 ? (
          <ul className="space-y-4">
            {trending.map((p, idx) => (
              <li key={p.id} className="font-semibold text-xl">
                {idx + 1}.{" "}
                <Link
                  to={`/player/${p.slug || p.id}`}
                  className="text-[#0055a5] hover:underline"
                >
                  {p.name}
                </Link>{" "}
                — {p.position}, {p.school}
              </li>
            ))}
          </ul>
        ) : (
          <p className="italic text-gray-500">No trending players this week.</p>
        )}
      </div>

      {/* Feature / Promo Section */}
      <div className="grid md:grid-cols-3 gap-8 w-full max-w-6xl mb-16">
        <Link
          to="/community"
          className="bg-white border-4 border-[#f6a21d] rounded-lg shadow hover:shadow-xl transition p-6 block"
        >
          <h2 className="text-2xl font-bold mb-4">Community Boards</h2>
          <p className="text-sm md:text-base">
            See what the public thinks about the best players in the country.
          </p>
        </Link>

        <Link
          to="/boards"
          className="bg-white border-4 border-[#f6a21d] rounded-lg shadow hover:shadow-xl transition p-6 block"
        >
          <h2 className="text-2xl font-bold mb-4">My Boards</h2>
          <p className="text-sm md:text-base">
            Create and store all your evaluations in one place.
          </p>
        </Link>

        <Link
          to="/community" // or a dedicated player list page
          className="bg-white border-4 border-[#f6a21d] rounded-lg shadow hover:shadow-xl transition p-6 block"
        >
          <h2 className="text-2xl font-bold mb-4">Player Profiles</h2>
          <p className="text-sm md:text-base">
            Dive deep into player evaluations with measurables, strengths,
            weaknesses, and community feedback — all in one place.
          </p>
        </Link>
      </div>

      {/* Future Promo Block */}
      <div className="bg-[#0055a5] text-white rounded-lg p-8 max-w-4xl w-full shadow-md">
        <h2 className="text-3xl font-extrabold mb-4 text-[#f6a21d]">
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
