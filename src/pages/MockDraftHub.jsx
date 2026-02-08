import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  orderBy,
  where,
} from "firebase/firestore";

import { db } from "../firebase";
import OutlineLogo from "../assets/outlinelogo.png";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function MockDraftHub() {
  const navigate = useNavigate();

  const [mocks, setMocks] = useState([]);
  const [loading, setLoading] = useState(true);
const [userMap, setUserMap] = useState({});

  /* ================= LOAD MOCKS ================= */

  useEffect(() => {
    const loadMocks = async () => {
      try {
        const q = query(
  collection(db, "mockDrafts"),
  where("visibility", "==", "public"),
  orderBy("updatedAt", "desc")
);


        const snap = await getDocs(q);

        setMocks(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      } catch (err) {
        console.error("Failed to load mock drafts", err);
      } finally {
        setLoading(false);
      }
    };

    loadMocks();
  }, []);
useEffect(() => {
  const loadUsers = async () => {
    try {
      const snap = await getDocs(collection(db, "users"));
      const map = {};

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        map[docSnap.id] =
          data.username || data.email || docSnap.id;
      });

      setUserMap(map);
    } catch (err) {
      console.error("Failed to load users", err);
    }
  };

  loadUsers();
}, []);

  /* ================= RENDER ================= */

  return (
    <div style={styles.page}>
      {/* HEADER */}
      <div style={styles.header}>
        <div style={styles.logoWrap}>
          <img
            src={OutlineLogo}
            alt="We-Draft Logo"
            style={styles.logo}
          />
        </div>

        <h1 style={styles.title}>MOCK DRAFT HUB</h1>
      </div>

      {/* MY MOCKS BUTTON */}
      <div style={styles.myMocksWrap}>
        <button
          style={styles.myMocksButton}
          onClick={() => navigate("/mocks/my")}
        >
          My Mocks
        </button>
      </div>

      {/* SECTION TITLE */}
      <div style={styles.sectionTitle}>New Mock Drafts</div>

      {/* LIST */}
      {loading ? (
        <div style={styles.loading}>Loading…</div>
      ) : mocks.length === 0 ? (
        <div style={styles.empty}>
          No mock drafts yet.
        </div>
      ) : (
        <div style={styles.list}>
          {mocks.map((mock) => (
            <div key={mock.id} style={styles.item}>
              <div style={styles.mockName}>
                {mock.name || "Untitled Mock Draft"}
              </div>

             <div style={styles.author}>
  by {userMap[mock.ownerId] || "Unknown User"}
</div>


              <div style={styles.meta}>
                {(mock.rounds || 1)} Round{(mock.rounds || 1) > 1 ? "s" : ""} •{" "}
                {mock.updatedAt?.toDate
                  ? mock.updatedAt.toDate().toLocaleDateString()
                  : "—"}
              </div>

              <button
                style={styles.viewButton}
                onClick={() => navigate(`/mocks/${mock.id}`)}
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= STYLES ================= */

const styles = {
  page: {
    maxWidth: "900px",
    margin: "0 auto",
    padding: "60px 20px",
  },

  header: {
    textAlign: "center",
    marginBottom: "60px",
  },

  logoWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "26px",
  },

  logo: {
    width: "1000px",
    maxWidth: "90%",
    height: "auto",
  },

  title: {
    fontSize: "52px",
    fontWeight: "900",
    letterSpacing: "2px",
    color: SITE_BLUE,
  },

  myMocksWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "40px",
  },

  myMocksButton: {
    backgroundColor: SITE_BLUE,
    color: "#ffffff",
    fontSize: "18px",
    fontWeight: "900",
    padding: "14px 36px",
    borderRadius: "999px",
    border: `4px solid ${SITE_GOLD}`,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  sectionTitle: {
    fontSize: "22px",
    fontWeight: "900",
    color: SITE_BLUE,
    marginBottom: "22px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: "22px",
  },

  item: {
    paddingBottom: "18px",
    borderBottom: "1px solid #e5e5e5",
  },

  mockName: {
    fontSize: "20px",
    fontWeight: "800",
    color: SITE_BLUE,
    marginBottom: "4px",
  },

  author: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#555",
    marginBottom: "2px",
  },

  meta: {
    fontSize: "13px",
    color: "#777",
    fontWeight: "600",
    marginBottom: "10px",
  },

  viewButton: {
    backgroundColor: SITE_GOLD,
    border: "none",
    borderRadius: "8px",
    padding: "6px 14px",
    fontWeight: "800",
    cursor: "pointer",
  },

  loading: {
    textAlign: "center",
    fontWeight: "700",
    color: "#777",
  },

  empty: {
    textAlign: "center",
    fontWeight: "700",
    color: "#777",
  },
};
