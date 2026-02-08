import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function ViewMock() {
  const { mockId } = useParams();
  const navigate = useNavigate();

  const [mock, setMock] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMock = async () => {
      try {
        const ref = doc(db, "mockDrafts", mockId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setMock(null);
        } else {
          setMock({ id: snap.id, ...snap.data() });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadMock();
  }, [mockId]);

  if (loading) {
    return <div style={{ padding: 40 }}>Loading mock…</div>;
  }

  if (!mock) {
    return (
      <div style={{ padding: 40 }}>
        <h2>Mock not found</h2>
        <button onClick={() => navigate("/mocks/my")}>
          Back to My Mocks
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 40 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>
        {mock.name || "Untitled Mock Draft"}
      </h1>

      <p style={{ marginTop: 10, opacity: 0.7 }}>
        Rounds: {mock.rounds}
      </p>

      <pre
        style={{
          marginTop: 30,
          background: "#f5f5f5",
          padding: 20,
          borderRadius: 10,
          overflowX: "auto",
        }}
      >
        {JSON.stringify(mock.picks, null, 2)}
      </pre>
    </div>
  );
}
