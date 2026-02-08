import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebase";

/* ================= CONSTANTS ================= */

const MAX_MOCKS = 5;
const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function MyMocksPage() {
  const navigate = useNavigate();
  const auth = getAuth();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mocks, setMocks] = useState([]);
  const [error, setError] = useState("");

  /* ================= AUTH ================= */

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, [auth]);

  /* ================= LOAD MOCKS ================= */

  useEffect(() => {
    if (!user) return;

    const loadMocks = async () => {
      const q = query(
        collection(db, "mockDrafts"),
        where("ownerId", "==", user.uid)
      );
      const snap = await getDocs(q);

      const data = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // sort newest first
      data.sort(
        (a, b) =>
          (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)
      );

      setMocks(data);
    };

    loadMocks();
  }, [user]);

  /* ================= DELETE MOCK ================= */

  const handleDelete = async (id) => {
    const ok = window.confirm(
      "Are you sure you want to delete this mock draft? This cannot be undone."
    );
    if (!ok) return;

    await deleteDoc(doc(db, "mockDrafts", id));
    setMocks((prev) => prev.filter((m) => m.id !== id));
  };

  /* ================= GUARDS ================= */

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ textAlign: "center", fontWeight: 700 }}>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.loginGate}>
          PLEASE LOG IN TO MAKE A MOCK DRAFT
        </div>
      </div>
    );
  }

  const atLimit = mocks.length >= MAX_MOCKS;

  /* ================= RENDER ================= */

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>My Mock Drafts</h1>
      </div>

      {/* Action Buttons */}
      <div style={styles.actionStack}>
        <button
          style={styles.secondaryButton}
          onClick={() => navigate("/mocks")}
        >
          MOCK DRAFT HUB
        </button>

        <button
          style={{
            ...styles.primaryButton,
            opacity: atLimit ? 0.5 : 1,
            cursor: atLimit ? "not-allowed" : "pointer",
          }}
          disabled={atLimit}
          onClick={() => {
            if (atLimit) {
              setError("Please delete a mock to create a new one.");
            } else {
              navigate("/mocks/create");
            }
          }}
        >
          <span style={styles.plus}>＋</span>
          CREATE MOCK
        </button>

        {error && <div style={styles.error}>{error}</div>}
      </div>

      {/* Section Header */}
      <div style={styles.sectionHeader}>MY MOCKS</div>

      {/* Mocks List */}
      <div style={styles.list}>
        {mocks.length === 0 ? (
          <div style={styles.emptyState}>
            You haven’t created a mock draft yet.
          </div>
        ) : (
          mocks.map((mock) => (
            <div key={mock.id} style={styles.mockRow}>
              <div>
                <div
                  style={styles.mockLink}
                  onClick={() => navigate(`/mocks/${mock.id}`)}
                >
                  {mock.name || "Untitled Mock Draft"}
                </div>

                <div style={styles.mockDate}>
                  Last saved{" "}
                  {mock.updatedAt?.seconds
                    ? new Date(
                        mock.updatedAt.seconds * 1000
                      ).toLocaleDateString()
                    : "—"}
                </div>
              </div>

              <button
                onClick={() => handleDelete(mock.id)}
                style={styles.deleteButton}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ================= STYLES ================= */

const styles = {
  page: {
    maxWidth: "900px",
    margin: "0 auto",
    padding: "40px 20px",
  },

  header: {
    marginBottom: "30px",
    textAlign: "center",
  },

  title: {
    fontSize: "28px",
    fontWeight: "800",
  },

  actionStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    marginBottom: "40px",
  },

  primaryButton: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    backgroundColor: SITE_BLUE,
    color: "#ffffff",
    fontSize: "20px",
    fontWeight: "900",
    padding: "18px 40px",
    borderRadius: "999px",
    border: `4px solid ${SITE_GOLD}`,
    letterSpacing: "1px",
    textTransform: "uppercase",
  },

  secondaryButton: {
    backgroundColor: "#ffffff",
    color: SITE_BLUE,
    fontSize: "16px",
    fontWeight: "800",
    padding: "14px 32px",
    borderRadius: "999px",
    border: `3px solid ${SITE_GOLD}`,
    cursor: "pointer",
    textTransform: "uppercase",
  },

  plus: {
    fontSize: "26px",
    lineHeight: "1",
  },

  error: {
    marginTop: 6,
    fontWeight: 700,
    color: "#c0392b",
  },

  sectionHeader: {
    textAlign: "center",
    fontSize: "22px",
    fontWeight: "900",
    color: SITE_BLUE,
    marginBottom: "24px",
    textTransform: "uppercase",
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },

  mockRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottom: "1px solid #eee",
  },

  mockLink: {
    fontSize: "18px",
    fontWeight: "800",
    color: SITE_BLUE,
    cursor: "pointer",
  },

  mockDate: {
    fontSize: "13px",
    color: "#777",
    marginTop: 4,
  },

  deleteButton: {
    background: "transparent",
    color: "#c0392b",
    border: "none",
    fontWeight: "800",
    cursor: "pointer",
  },

  loginGate: {
    textAlign: "center",
    fontSize: "22px",
    fontWeight: "900",
    color: SITE_BLUE,
    border: `4px solid ${SITE_GOLD}`,
    borderRadius: "999px",
    padding: "20px 30px",
    maxWidth: "480px",
    margin: "80px auto",
    textTransform: "uppercase",
  },

  emptyState: {
    textAlign: "center",
    fontSize: "18px",
    fontWeight: "700",
    color: "#777",
  },
};
