import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import WeDraftLogo from "../assets/Logo1.png";

export default function PlayerPageV4() {
  const { slug } = useParams();
  const [player, setPlayer] = useState(null);
  const [school, setSchool] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      const q = query(
        collection(db, "players"),
        where("Slug", "==", slug)
      );

      const snap = await getDocs(q);

      if (!snap.empty) {
        const playerData = snap.docs[0].data();
        setPlayer(playerData);

        const schoolSnap = await getDoc(
          doc(db, "schools", playerData.School)
        );

        if (schoolSnap.exists()) {
          setSchool(schoolSnap.data());
        }
      }
    };

    fetchData();
  }, [slug]);

  if (!player || !school) return null;

  return (
    <div style={styles.page}>
      <div style={styles.container}>

        {/* LEFT MAIN */}
        <div style={styles.main}>

          {/* HERO ROW */}
          <div style={styles.heroRow}>

            {/* PLAYER NAME BLOCK */}
            <div style={styles.nameBlock}>
              <div
                style={{
                  ...styles.playerName,
                  color: school.Color1,
                }}
              >
                {player.First?.toUpperCase()}
              </div>

              <div
                style={{
                  ...styles.playerName,
                  color: school.Color1,
                }}
              >
                {player.Last?.toUpperCase()}
              </div>
            </div>

            {/* SCHOOL BLOCK */}
            <div style={styles.schoolBlock}>
              <img
                src={school.Logo1}
                alt="School Logo"
                style={styles.schoolLogo}
              />
              <div style={styles.schoolText}>
                <div style={styles.schoolName}>
                  {school.School?.toUpperCase()}
                </div>
                <div style={styles.mascot}>
                  {school.Mascot?.toUpperCase()}
                </div>
              </div>
            </div>

          </div>

          {/* META CENTERED */}
          <div style={styles.metaCentered}>
            {player.Eligible} {player.Position} | {player.Height} {player.Weight}
          </div>

          {/* BUTTONS CENTERED */}
          <div style={styles.buttonRow}>
            <button style={styles.pill}>FILM</button>
            <button style={styles.pill}>STATS</button>
            <button style={styles.pill}>GRADE</button>
          </div>

          {/* COMMUNITY CENTERED */}
          <div style={styles.community}>
            <img
              src={WeDraftLogo}
              alt="We-Draft"
              style={styles.brandLogo}
            />
            <div style={styles.communityTitle}>
              COMMUNITY GRADES
            </div>
            <div
              style={{
                ...styles.consensus,
                color: school.Color1,
              }}
            >
              {player.CommunityGrade || "—"}
            </div>
          </div>

          {/* THREE BOXES */}
          <div style={styles.boxGrid}>
            <div style={styles.box}>
              <h3 style={styles.boxTitle}>STRENGTHS</h3>
              <div>{player.Strengths || ""}</div>
            </div>

            <div style={styles.box}>
              <h3 style={styles.boxTitle}>WEAKNESSES</h3>
              <div>{player.Weaknesses || ""}</div>
            </div>

            <div style={styles.box}>
              <h3 style={styles.boxTitle}>NFL FIT</h3>
              <div>{player.NFLFit || ""}</div>
            </div>
          </div>

        </div>

        {/* RIGHT RAIL */}
        <div style={styles.rightRail}>
          <div style={styles.railCard}>
            Rotating content / Ads go here
          </div>
        </div>

      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: "80px 80px",
  },

  container: {
    display: "flex",
    gap: "80px",
    maxWidth: "1500px",
    margin: "0 auto",
  },

  main: {
    flex: "0 0 70%",
  },

  rightRail: {
    flex: "0 0 30%",
  },

  railCard: {
    position: "sticky",
    top: "120px",
    border: "1px solid #eee",
    borderRadius: "20px",
    padding: "30px",
  },

  heroRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  nameBlock: {
    lineHeight: "0.95",
  },

  playerName: {
    fontSize: "72px",
    fontWeight: "900",
    letterSpacing: "1px",
  },

  schoolBlock: {
    display: "flex",
    alignItems: "center",
    gap: "20px",
  },

  schoolLogo: {
    height: "140px",
  },

  schoolText: {
    display: "flex",
    flexDirection: "column",
  },

  schoolName: {
    fontSize: "32px",
    fontWeight: "800",
    fontStyle: "italic",
  },

  mascot: {
    fontSize: "32px",
    fontWeight: "800",
    fontStyle: "italic",
  },

  metaCentered: {
    textAlign: "center",
    fontSize: "34px",
    fontWeight: "800",
    marginTop: "30px",
  },

  buttonRow: {
    display: "flex",
    justifyContent: "center",
    gap: "40px",
    margin: "60px 0",
  },

  pill: {
    padding: "18px 45px",
    borderRadius: "40px",
    border: "4px solid #bfa46f",
    background: "#7a263a",
    color: "white",
    fontWeight: "900",
    fontSize: "22px",
    cursor: "pointer",
  },

  community: {
    textAlign: "center",
    marginBottom: "80px",
  },

  brandLogo: {
    width: "500px",
    marginBottom: "10px",
  },

  communityTitle: {
    fontSize: "56px",
    fontWeight: "900",
  },

  consensus: {
    fontSize: "64px",
    fontWeight: "900",
    marginTop: "20px",
  },

  boxGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "60px",
  },

  box: {
    border: "8px solid #bfa46f",
    borderRadius: "50px",
    height: "360px",
    padding: "30px",
  },

  boxTitle: {
    fontSize: "24px",
    fontWeight: "900",
    marginBottom: "20px",
  },
};