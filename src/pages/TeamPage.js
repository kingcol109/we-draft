import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { getAuth } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  updateDoc,
  increment,
} from "firebase/firestore";

export default function TeamPage() {
  const { teamId } = useParams();

  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [historical, setHistorical] = useState([]);
  const [loading, setLoading] = useState(true);
  const [positionRanks, setPositionRanks] = useState(null);
  const [teamArticles, setTeamArticles] = useState([]);
  const [viewMode, setViewMode] = useState("current");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [rosterYearMode, setRosterYearMode] = useState(2026);
  const [declaredIds, setDeclaredIds] = useState(() => new Set());
  const [redshirtOverrideIds, setRedshirtOverrideIds] = useState(() => new Set());
  const [hoveredPlayer, setHoveredPlayer] = useState(null);
  const [hoveredIcon, setHoveredIcon] = useState(null);
  const [userVotes, setUserVotes] = useState({});
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;

    const loadVotes = async () => {
      const rosterRef = doc(db, "rosters", teamId.toLowerCase());
      const rosterSnap = await getDoc(rosterRef);
      const rosterPlayers = rosterSnap.exists() ? rosterSnap.data().players || [] : [];

      const votesMap = {};
      await Promise.all(
        rosterPlayers.map(async (p, idx) => {
          const voteId = getVoteId({ ...p, _id: idx });
          try {
            const userVoteRef = doc(db, "votes", voteId, "users", user.uid);
            const snap = await getDoc(userVoteRef);
            if (snap.exists()) votesMap[voteId] = snap.data().value;
          } catch {}
        })
      );
      setUserVotes(votesMap);
    };

    loadVotes();
  }, [teamId]);

  const getVoteId = (p) => {
    const normalize = (str) =>
      (str || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
    return `${normalize(p.First)}-${normalize(p.Last)}-${normalize(p.School)}`;
  };

  const handleVote = async (p, value) => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
      const auth2 = getAuth();
      const provider = new GoogleAuthProvider();
      try { await signInWithPopup(auth2, provider); } catch { return; }
    }
    const voteId = getVoteId(p);
    const oldValue = userVotes[voteId] || 0;
    const newValue = oldValue === value ? 0 : value;
    const delta = newValue - oldValue;
    const voteRef = doc(db, "votes", voteId);
    const userVoteRef = doc(db, "votes", voteId, "users", user.uid);
    await setDoc(voteRef, { voteScore: increment(delta) }, { merge: true });
    await setDoc(userVoteRef, { value: newValue });
    setUserVotes((prev) => ({ ...prev, [voteId]: newValue }));
  };

  const formatTeamId = (str) => {
    const lower = str.toLowerCase();
    const map = {
      "army": "Army West Point", "nc-state": "NC State", "uconn": "UConn",
      "troy": "Troy", "lsu": "LSU", "smu": "SMU", "tcu": "TCU",
      "ucla": "UCLA", "ucf": "UCF",
    };
    if (map[lower]) return map[lower];
    if (/^[a-z]{2,5}$/i.test(str)) return str.toUpperCase();
    return str.toLowerCase().split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  };

  const sanitizeImgur = (url) =>
    url?.includes("imgur.com") ? url.replace("imgur.com", "i.imgur.com") + ".png" : url;

  const primary = team?.Color1 || "#0055a5";
  const secondary = team?.Color2 || "#f6a21d";

  const YEARS = ["Senior", "Junior", "Sophomore", "Freshman"];
  const OFFENSE_POS = ["QB", "RB", "WR", "TE", "OL"];
  const DEFENSE_POS = ["EDGE", "DL", "LB", "DB"];
  const POSITION_ORDER = ["QB", "RB", "WR", "TE", "OL", "DE", "DT", "LB", "CB", "S"];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const formattedId = formatTeamId(teamId);
      let teamData = null;

      const teamRef = doc(db, "schools", formattedId);
      const teamSnap = await getDoc(teamRef);
      if (teamSnap.exists()) {
        teamData = teamSnap.data();
      } else {
        const schoolsRef = collection(db, "schools");
        const snapshot = await getDocs(schoolsRef);
        const normalize = (str) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const target = normalize(teamId);
        let bestMatch = null;
        snapshot.forEach((doc) => {
          const school = doc.data().School;
          const s = normalize(school);
          if (s === target) { bestMatch = doc.data(); return; }
          if (!bestMatch && s.startsWith(target)) { bestMatch = doc.data(); return; }
          if (!bestMatch && s.includes(target)) { bestMatch = doc.data(); }
        });
        teamData = bestMatch;
      }

      if (!teamData) { setLoading(false); return; }
      setTeam(teamData);

      const rosterRef = doc(db, "rosters", teamId.toLowerCase());
      const rosterSnap = await getDoc(rosterRef);
      const rosterPlayers = rosterSnap.exists() ? rosterSnap.data().players || [] : [];
      setPlayers(rosterPlayers.map((p, idx) => ({ ...p, _id: idx })));

      const colRef = collection(db, "historical");
      const q = query(colRef, where("School", "==", teamData.School));
      const snapshot = await getDocs(q);
      setHistorical(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));

      const rankRef = doc(db, "teamPositionRanks", teamId.toLowerCase());
      const rankSnap = await getDoc(rankRef);
      if (rankSnap.exists()) {
        setPositionRanks(rankSnap.data());
        const articleQuery = query(
          collection(db, "articles"),
          where("status", "==", "published"),
          where("teamSlugs", "array-contains", teamId.toLowerCase())
        );
        const articleSnap = await getDocs(articleQuery);
        setTeamArticles(articleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }

      setLoading(false);
    };
    fetchData();
  }, [teamId]);

  const hasSlug = (p) => Boolean((p.Slug ?? "").toString().trim());
  const rsStringIsYes = (v) => (v ?? "").toString().trim().toLowerCase() === "yes";

  const isRedshirtDisplay = (p) => {
    if (rosterYearMode === 2026) return rsStringIsYes(p.RS);
    return rsStringIsYes(p.RS) || redshirtOverrideIds.has(p._id);
  };

  const sortRosterPlayers = (arr) => {
    const gradeRank = (g) => {
      if (!g) return 100;
      const grade = g.toString().toUpperCase().trim();
      if (/^[1-5]$/.test(grade)) return 6 - Number(grade);
      if (grade === "A+") return 9; if (grade === "A") return 10;
      if (grade === "B") return 11; if (grade === "C") return 12;
      if (grade === "D") return 13; if (grade === "W") return 20;
      return 90;
    };
    return [...arr].sort((a, b) => {
      const ga = gradeRank(a.Grade), gb = gradeRank(b.Grade);
      if (ga !== gb) return ga - gb;
      const la = (a.Last || "").toLowerCase(), lb = (b.Last || "").toLowerCase();
      if (la < lb) return -1; if (la > lb) return 1;
      return 0;
    });
  };

  const ageForward = (year) => {
    if (year === "Senior") return "LEAVES";
    if (year === "Junior") return "Senior";
    if (year === "Sophomore") return "Junior";
    if (year === "Freshman") return "Sophomore";
    return year;
  };

  const moveDownOne = (year) => {
    if (year === "Senior") return "Junior";
    if (year === "Junior") return "Sophomore";
    if (year === "Sophomore") return "Freshman";
    return year;
  };

  const isDraftEligibleIn2027 = (p) => {
    const baseYear = p.Year;
    const baseRS = rsStringIsYes(p.RS) || redshirtOverrideIds.has(p._id);
    if (baseYear === "Senior") return true;
    if (baseYear === "Junior") return true;
    if (baseYear === "Sophomore" && baseRS) return true;
    return false;
  };

  const displayPlayers = useMemo(() => {
    if (rosterYearMode === 2026) return players;
    return players.map((p) => {
      let y = ageForward(p.Year);
      if (redshirtOverrideIds.has(p._id)) {
        if (y !== "LEAVES") y = moveDownOne(y);
      }
      return { ...p, _displayYear: y };
    });
  }, [players, rosterYearMode, redshirtOverrideIds]);

  const getGradeColor = (grade) => {
    const g = grade?.toString().toUpperCase().trim();
    if (g === "5") return "#0026ff"; if (g === "4") return "#00a83e";
    if (g === "3") return "#eab308"; if (g === "2") return "#f97316";
    if (g === "1") return "#ef4444"; if (g === "A+") return "#00ff40";
    if (g === "A") return "#00d9ff"; if (g === "B") return "#dc00f0";
    if (g === "C") return "#a74300"; if (g === "D") return "#850000";
    if (g === "W") return "#000000";
    return "#111";
  };

  const leavesIn2027 = useMemo(() => {
    if (rosterYearMode !== 2027) return [];
    const agedLeaves = displayPlayers.filter((p) => p._displayYear === "LEAVES");
    const declaredLeaves = displayPlayers.filter((p) => declaredIds.has(p._id));
    const map = new Map();
    [...agedLeaves, ...declaredLeaves].forEach((p) => map.set(p._id, p));
    return Array.from(map.values());
  }, [displayPlayers, rosterYearMode, declaredIds]);

  const rosterGridPlayers = useMemo(() => {
    if (rosterYearMode === 2026) return players;
    return displayPlayers.filter(
      (p) => p._displayYear !== "LEAVES" && !declaredIds.has(p._id)
    );
  }, [players, displayPlayers, rosterYearMode, declaredIds]);

  const positionCounts = useMemo(() => {
    if (!historical.length) return {};
    const counts = {};
    historical.forEach((p) => { if (p.Position) counts[p.Position] = (counts[p.Position] || 0) + 1; });
    return counts;
  }, [historical]);

  const toggleDeclare = (id) => {
    setDeclaredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleRedshirt = (p) => {
    if (rosterYearMode !== 2027) return;
    if (rsStringIsYes(p.RS)) return;
    setRedshirtOverrideIds((prev) => {
      const next = new Set(prev);
      if (next.has(p._id)) next.delete(p._id); else next.add(p._id);
      return next;
    });
  };

  const SectionHeader = ({ children }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: primary, marginBottom: 6 }}>
        {children}
      </div>
      <div style={{ height: 3, backgroundColor: primary, borderRadius: 2 }} />
    </div>
  );

  // ── A+ Tooltip — redesigned ──────────────────────────────────────────────
  const BluechipTooltip = ({ p }) => (
    <div style={{
      position: "absolute", bottom: "calc(100% + 10px)", left: "50%",
      transform: "translateX(-50%)",
      width: 210, zIndex: 50,
      background: "linear-gradient(160deg, #001a3a 0%, #003070 100%)",
      border: `2px solid ${secondary}`,
      borderRadius: 10,
      boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
      overflow: "hidden",
      fontFamily: "'Arial Black', Arial, sans-serif",
    }}>
      {/* Gold header bar */}
      <div style={{ background: secondary, padding: "6px 12px", textAlign: "center" }}>
        <div style={{ fontSize: 8, fontWeight: 900, color: "#0055a5", textTransform: "uppercase", letterSpacing: "0.18em" }}>
          We-Draft.com
        </div>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#0055a5", textTransform: "uppercase", letterSpacing: "0.12em", lineHeight: 1.1, marginTop: 1 }}>
          Bluechip Prospect
        </div>
      </div>
      {/* Player name */}
      <div style={{ padding: "8px 12px 4px", textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "#fff", letterSpacing: "0.04em", lineHeight: 1.2 }}>
          {p.First} {p.Last}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
          {p.Year} · {p.Position}
        </div>
      </div>
      {/* Divider */}
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${secondary}, transparent)`, margin: "2px 12px" }} />
      {/* Notes */}
      <div style={{ padding: "6px 12px 10px" }}>
        {p.Notes && <div style={{ fontSize: 11, fontWeight: 800, color: secondary, lineHeight: 1.4, marginBottom: p.Notes2 ? 4 : 0 }}>{p.Notes}</div>}
        {p.From && <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>{p.From}</div>}
        {p.Notes2 && <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{p.Notes2}</div>}
      </div>
      {/* Arrow */}
      <div style={{ position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: `7px solid ${secondary}` }} />
    </div>
  );

  const RegularTooltip = ({ p }) => (
    <div style={{
      position: "absolute", bottom: "calc(100% + 10px)", left: "50%",
      transform: "translateX(-50%)",
      width: 200, zIndex: 50,
      background: "#1a1a1a",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 8,
      boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
      overflow: "hidden",
      fontFamily: "'Arial Black', Arial, sans-serif",
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>{p.First} {p.Last}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 700, marginTop: 1 }}>{p.Year} · {p.Position}</div>
        {p.Grade === "5" && <div style={{ marginTop: 4, fontSize: 10, fontWeight: 900, color: "#ffd700", letterSpacing: "0.08em" }}>★ IMPACT PLAYER ★</div>}
      </div>
      <div style={{ padding: "8px 12px" }}>
        {p.Notes && <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)", lineHeight: 1.4, marginBottom: p.Notes2 ? 4 : 0 }}>{p.Notes}</div>}
        {p.From && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4 }}>{p.From}</div>}
        {p.Notes2 && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{p.Notes2}</div>}
      </div>
      <div style={{ position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "6px solid #1a1a1a" }} />
    </div>
  );

  const renderSectionMobile = (positions, label) => {
    const allPlayers = rosterGridPlayers;
    return (
      <div style={{ marginBottom: 40 }}>
        <SectionHeader>{label}</SectionHeader>
        {positions.map((pos) => {
          const posPlayers = sortRosterPlayers(allPlayers.filter((p) => p.Position === pos));
          if (!posPlayers.length) return null;
          return (
            <div key={pos} style={{ marginBottom: 16 }}>
              <div style={{ backgroundColor: primary, color: "#fff", fontWeight: 900, fontSize: 18, padding: "8px 14px", borderBottom: `3px solid ${secondary}`, letterSpacing: "0.06em" }}>
                {pos}
              </div>
              {YEARS.map((year) => {
                const yearPos = posPlayers.filter((p) =>
                  rosterYearMode === 2026 ? p.Year === year : p._displayYear === year
                );
                if (!yearPos.length) return null;
                return (
                  <div key={year} style={{ display: "flex", alignItems: "flex-start", borderBottom: `1px solid ${secondary}` }}>
                    <div style={{ width: 72, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 11, color: primary, background: "#f9f9f9", borderRight: `2px solid ${secondary}`, padding: "10px 4px", textAlign: "center", letterSpacing: "0.04em" }}>
                      {year.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, padding: "8px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {yearPos.map((p) => {
                        const italic = isRedshirtDisplay(p);
                        const slugged = hasSlug(p);
                        const showIcons = rosterYearMode === 2027;
                        const showNFL = showIcons && isDraftEligibleIn2027(p);
                        const showShirt = showIcons && !rsStringIsYes(p.RS);
                        return (
                          <div key={p._id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <div style={{ background: primary, border: `2px solid ${secondary}`, borderRadius: 8, color: "#fff", display: "flex", alignItems: "stretch", minWidth: 80 }}>
                              {p.Grade && (
                                <div style={{ background: p.Grade === "A+" ? secondary : "#fff", color: p.Grade === "A+" ? "#fff" : getGradeColor(p.Grade), fontWeight: 900, fontSize: 14, width: 22, minWidth: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "6px 0 0 6px", borderRight: `2px solid ${secondary}` }}>
                                  {p.Grade === "A+" ? "A+" : p.Grade}
                                </div>
                              )}
                              <div style={{ padding: "5px 7px", textAlign: "center", fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>
                                {slugged ? (
                                  <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", textDecoration: "underline", fontStyle: italic ? "italic" : "normal" }}>
                                    <div>{p.First}</div><div>{p.Last}</div>
                                  </a>
                                ) : (
                                  <div style={{ fontStyle: italic ? "italic" : "normal" }}>
                                    <div>{p.First}</div><div>{p.Last}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                            {showIcons && (showNFL || showShirt) && (
                              <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                                {showNFL && <span onClick={() => toggleDeclare(p._id)} style={{ cursor: "pointer", fontSize: 14 }}>🏈</span>}
                                {showShirt && <span onClick={() => toggleRedshirt(p)} style={{ cursor: "pointer", fontSize: 14, opacity: redshirtOverrideIds.has(p._id) ? 1 : 0.7 }}>👕</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSection = (positions, label) => {
    if (isMobile) return renderSectionMobile(positions, label);
    return (
      <div style={{ marginBottom: 70 }}>
        <SectionHeader>{label}</SectionHeader>

        <div style={{ display: "grid", gridTemplateColumns: `160px repeat(${positions.length}, 1fr)`, position: "sticky", top: 0, background: "#fff", zIndex: 30, borderTop: `4px solid ${secondary}`, borderBottom: `4px solid ${secondary}` }}>
          <div />
          {positions.map((pos) => (
            <div key={pos} style={{ textAlign: "center", fontWeight: 900, fontSize: 26, padding: "14px 8px", borderLeft: `2px solid ${secondary}`, color: primary, letterSpacing: 0.5 }}>
              {pos}
            </div>
          ))}
        </div>

        {YEARS.map((year) => {
          const yearPlayers = rosterYearMode === 2026
            ? rosterGridPlayers.filter((p) => p.Year === year)
            : rosterGridPlayers.filter((p) => p._displayYear === year);
          if (!yearPlayers.length) return null;

          return (
            <div key={year} style={{ display: "grid", gridTemplateColumns: `160px repeat(${positions.length}, 1fr)`, borderBottom: `2px solid ${secondary}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, borderRight: `2px solid ${secondary}`, background: "#f9f9f9", padding: "14px 10px" }}>
                {year.toUpperCase()}
              </div>

              {positions.map((pos) => {
                const posPlayers = sortRosterPlayers(yearPlayers.filter((p) => p.Position === pos));
                return (
                  <div key={pos} style={{ padding: 14, borderLeft: `2px solid ${secondary}`, minHeight: 90 }}>
                    {posPlayers.map((p) => {
                      const italic = isRedshirtDisplay(p);
                      const slugged = hasSlug(p);
                      const showIcons = rosterYearMode === 2027;
                      const showNFL = showIcons && isDraftEligibleIn2027(p);
                      const showShirt = showIcons && !rsStringIsYes(p.RS);
                      const isAPlus = p.Grade === "A+";

                      return (
                        <div key={p._id} style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 10 }}>
                          <div style={{
                            width: "92%", background: primary, border: `3px solid ${secondary}`,
                            borderRadius: 10, padding: "10px 10px 8px",
                            boxShadow: isAPlus ? `0 0 16px rgba(246,162,29,0.35)` : "0 1px 0 rgba(0,0,0,0.08)",
                            color: "#fff", display: "flex", alignItems: "stretch", justifyContent: "center", gap: 8, position: "relative",
                          }}>
                            <div style={{ display: "flex", alignItems: "stretch", justifyContent: "center", gap: 10, width: "100%" }}>
                              {p.Grade && (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "-10px 0 -8px -10px", alignSelf: "stretch" }}>
                                  <div style={{
                                    display: "flex", alignItems: "stretch", justifyContent: "flex-start",
                                    fontWeight: 900, fontSize: 18,
                                    color: isAPlus ? "#0055a5" : getGradeColor(p.Grade),
                                    background: isAPlus ? secondary : "#ffffff",
                                    padding: 0, width: 28, minWidth: 28, height: "100%",
                                    borderRadius: "7px 0 0 7px", borderRight: `3px solid ${secondary}`,
                                  }}>
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 52, padding: "4px 0", lineHeight: 1 }}>
                                      <span onClick={() => handleVote(p, 1)} style={{ cursor: "pointer", fontSize: 10, color: userVotes[getVoteId(p)] === 1 ? "#00c94f" : (isAPlus ? "rgba(0,40,100,0.5)" : "#aaa"), fontWeight: userVotes[getVoteId(p)] === 1 ? 900 : 400, marginBottom: -2 }}>▲</span>
                                      <div style={{ display: "flex", alignItems: "center" }}>
                                        {isAPlus ? (
                                          <><span>A</span><span style={{ fontSize: 10, marginLeft: 1, position: "relative", top: -2 }}>+</span></>
                                        ) : p.Grade}
                                      </div>
                                      <span onClick={() => handleVote(p, -1)} style={{ cursor: "pointer", fontSize: 9, color: userVotes[getVoteId(p)] === -1 ? "#ff4444" : (isAPlus ? "rgba(0,40,100,0.5)" : "#aaa"), fontWeight: userVotes[getVoteId(p)] === -1 ? 900 : 400, lineHeight: 1 }}>▼</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div style={{ position: "relative", textAlign: "center", flex: 1 }}
                                onMouseEnter={() => setHoveredPlayer(p._id)}
                                onMouseLeave={() => setHoveredPlayer(null)}
                              >
                                {slugged ? (
                                  <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer"
                                    style={{ color: "#fff", fontWeight: 700, fontSize: "1.05rem", textDecoration: "underline", fontStyle: italic ? "italic" : "normal", lineHeight: 1.1, display: "block" }}>
                                    <div>{p.First}</div><div>{p.Last}</div>
                                  </a>
                                ) : (
                                  <div style={{ fontWeight: 700, fontSize: "1.05rem", fontStyle: italic ? "italic" : "normal", lineHeight: 1.1 }}>
                                    <div>{p.First}</div><div>{p.Last}</div>
                                  </div>
                                )}

                                {hoveredPlayer === p._id && (p.Notes || p.Notes2) && (
                                  isAPlus
                                    ? <BluechipTooltip p={p} />
                                    : <RegularTooltip p={p} />
                                )}
                              </div>
                            </div>
                          </div>

                          {showIcons && (showNFL || showShirt) && (
                            <div style={{ marginTop: 4, display: "flex", justifyContent: "center", gap: 10 }}>
                              {showNFL && (
                                <div style={{ position: "relative" }}
                                  onMouseEnter={() => setHoveredIcon(`nfl-${p._id}`)}
                                  onMouseLeave={() => setHoveredIcon(null)}>
                                  <span onClick={() => toggleDeclare(p._id)} style={{ cursor: "pointer", fontSize: 16 }}>🏈</span>
                                  {hoveredIcon === `nfl-${p._id}` && (
                                    <div style={{ position: "absolute", bottom: "130%", left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 12, whiteSpace: "nowrap", zIndex: 50, boxShadow: "0 4px 10px rgba(0,0,0,0.4)" }}>
                                      Declare for Draft (moves to LEAVES)
                                    </div>
                                  )}
                                </div>
                              )}
                              {showShirt && (
                                <div style={{ position: "relative" }}
                                  onMouseEnter={() => setHoveredIcon(`shirt-${p._id}`)}
                                  onMouseLeave={() => setHoveredIcon(null)}>
                                  <span onClick={() => toggleRedshirt(p)} style={{ cursor: "pointer", fontSize: 16, opacity: redshirtOverrideIds.has(p._id) ? 1 : 0.9 }}>👕</span>
                                  {hoveredIcon === `shirt-${p._id}` && (
                                    <div style={{ position: "absolute", bottom: "130%", left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 12, whiteSpace: "nowrap", zIndex: 50, boxShadow: "0 4px 10px rgba(0,0,0,0.4)" }}>
                                      Project Redshirt (moves player down a class)
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontSize: 20, fontWeight: 900, color: "#0055a5" }}>
      Loading Team...
    </div>
  );

  return (
    <>
      <Helmet>
        <title>{team?.School} {team?.Mascot} 2026 Roster & Draft Prospects | We-Draft</title>
        <meta name="description" content={`Full 2026 roster, player grades, and NFL draft prospects for the ${team?.School} ${team?.Mascot}.`} />
        <link rel="canonical" href={`https://we-draft.com/team/${teamId}`} />
        <meta property="og:title" content={`${team?.School} ${team?.Mascot} 2026 Roster | We-Draft`} />
        <meta property="og:description" content={`NFL draft prospects and full roster breakdown for ${team?.School}.`} />
        <meta property="og:url" content={`https://we-draft.com/team/${teamId}`} />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org", "@type": "SportsTeam",
            "name": `${team?.School} ${team?.Mascot}`, "sport": "American Football",
            "url": `https://we-draft.com/team/${teamId}`,
            "memberOf": { "@type": "SportsOrganization", "name": team?.Conference || "NCAA" }
          })}
        </script>
      </Helmet>

      <div className="max-w-7xl mx-auto p-6 pb-40">

        {/* ===== HERO CARD ===== */}
        <div className="mb-8 rounded-lg overflow-hidden" style={{ border: `3px solid ${primary}` }}>
          <div style={{ backgroundColor: "#fff", display: "flex", alignItems: "center", gap: isMobile ? 12 : 24, padding: isMobile ? "16px" : "24px 32px" }}>
            <div style={{ flexShrink: 0, width: isMobile ? 72 : 140, height: isMobile ? 72 : 140, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f8f8", border: "1px solid #eee", borderRadius: 8 }}>
              {team?.Logo1 ? <img src={sanitizeImgur(team.Logo1)} alt={`${team.School} logo`} style={{ height: isMobile ? 60 : 120, objectFit: "contain" }} loading="lazy" /> : <div style={{ width: isMobile ? 72 : 140, height: isMobile ? 72 : 140 }} />}
            </div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? "clamp(20px, 6vw, 32px)" : "clamp(32px, 5vw, 60px)", fontWeight: 900, color: primary, lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>{team?.School}</div>
              <div style={{ fontSize: isMobile ? "clamp(16px, 4.5vw, 24px)" : "clamp(24px, 3.5vw, 44px)", fontWeight: 900, color: primary, lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase", marginTop: 4 }}>{team?.Mascot}</div>
              {team?.Conference && (
                <div style={{ marginTop: 8, display: "inline-block", backgroundColor: primary, color: "#fff", fontWeight: 900, fontSize: isMobile ? 11 : 13, padding: "3px 14px", borderRadius: 20, letterSpacing: "0.05em" }}>{team.Conference}</div>
              )}
            </div>
            <div style={{ flexShrink: 0, width: isMobile ? 72 : 140, height: isMobile ? 72 : 140, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f8f8", border: "1px solid #eee", borderRadius: 8 }}>
              {team?.Logo2 ? <img src={sanitizeImgur(team.Logo2)} alt={`${team.School} alt logo`} style={{ height: isMobile ? 60 : 120, objectFit: "contain" }} loading="lazy" /> : <div style={{ width: isMobile ? 72 : 140, height: isMobile ? 72 : 140 }} />}
            </div>
          </div>
          <div style={{ height: 5, backgroundColor: secondary }} />
        </div>

        {/* ===== IN THE NEWS ===== */}
        {teamArticles.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <SectionHeader>In the News</SectionHeader>
            <div style={{ backgroundColor: "#fff", border: `2px solid ${primary}`, borderRadius: 8, overflow: "hidden" }}>
              {teamArticles
                .slice()
                .sort((a, b) => (b.publishedAt?.seconds || b.updatedAt?.seconds || 0) - (a.publishedAt?.seconds || a.updatedAt?.seconds || 0))
                .map((a, i, arr) => (
                  <a key={a.id} href={`/news/${a.slug}`}
                    style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", textDecoration: "none", borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none", backgroundColor: "#fff", transition: "background 0.15s" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f9fbff"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                  >
                    {/* Calendar date badge */}
                    <div style={{ flexShrink: 0, width: 48, background: "#fff", border: `2px solid ${primary}`, borderRadius: 6, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      <div style={{ background: secondary, lineHeight: 1, padding: "1px 0", textAlign: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {(a.publishedAt || a.updatedAt)?.toDate?.().toLocaleDateString(undefined, { month: "short" })}
                        </span>
                      </div>
                      <div style={{ padding: "4px 0 3px", textAlign: "center" }}>
                        <span style={{ fontSize: 20, fontWeight: 900, color: primary, lineHeight: 1, display: "block" }}>
                          {(a.publishedAt || a.updatedAt)?.toDate?.().toLocaleDateString(undefined, { day: "numeric" })}
                        </span>
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: 3 }}>
                        <span style={{ backgroundColor: primary, color: "#fff", fontWeight: 900, fontSize: 9, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.08em", textTransform: "uppercase" }}>Article</span>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 14, color: "#222", letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1.3 }}>{a.title}</div>
                    </div>
                    <div style={{ flexShrink: 0, fontWeight: 900, fontSize: 18, color: primary }}>→</div>
                  </a>
                ))}
            </div>
          </div>
        )}

        {/* ===== CONTROLS ROW ===== */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "stretch", gap: 12, marginBottom: 40, flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <button onClick={() => setDropdownOpen((prev) => !prev)}
              style={{ padding: "10px 28px", fontWeight: 900, borderRadius: 8, border: `2px solid ${secondary}`, cursor: "pointer", backgroundColor: primary, color: "#fff", minWidth: 160, textAlign: "center" }}>
              <div style={{ fontSize: 20 }}>{viewMode === "archive" ? "Draft Archive" : rosterYearMode === 2027 ? "2027 Projection" : "2026 Roster"}</div>
              <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>▾ change view</div>
            </button>
            {dropdownOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", backgroundColor: "#fff", border: `2px solid ${secondary}`, borderRadius: 8, overflow: "hidden", zIndex: 50, minWidth: 200, boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }}>
                {[
                  { label: "2026 Roster", action: () => { setViewMode("current"); setRosterYearMode(2026); setDropdownOpen(false); } },
                  { label: "2027 Projection", action: () => { setViewMode("current"); setRosterYearMode(2027); setDropdownOpen(false); } },
                  { label: "Draft Archive", action: () => { setViewMode("archive"); setDropdownOpen(false); } },
                ].map(({ label, action }, i, arr) => {
                  const isActive = (label === "2026 Roster" && viewMode === "current" && rosterYearMode === 2026) || (label === "2027 Projection" && viewMode === "current" && rosterYearMode === 2027) || (label === "Draft Archive" && viewMode === "archive");
                  return (
                    <div key={label} onClick={action}
                      style={{ padding: "12px 20px", cursor: "pointer", fontWeight: 800, fontSize: 15, color: primary, backgroundColor: isActive ? "#f0f5ff" : "#fff", borderBottom: i < arr.length - 1 ? "1px solid #eee" : "none", display: "flex", alignItems: "center", gap: 8 }}>
                      {isActive && <span style={{ color: secondary, fontWeight: 900 }}>✓</span>}
                      {label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ position: "relative" }}>
            <button style={{ backgroundColor: "#fff", color: primary, border: `2px solid ${secondary}`, padding: "10px 28px", borderRadius: 8, fontWeight: 900, cursor: "pointer", minWidth: 160, textAlign: "center" }}
              onMouseEnter={(e) => e.currentTarget.nextSibling.style.display = "block"}
              onMouseLeave={(e) => e.currentTarget.nextSibling.style.display = "none"}>
              <div style={{ fontSize: 20 }}>Player Grades</div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>▾</div>
            </button>
            <div style={{ display: "none", position: "absolute", top: "110%", left: "50%", transform: "translateX(-50%)", backgroundColor: "#fff", border: `2px solid ${secondary}`, borderRadius: 8, padding: "20px 24px", width: 420, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", textAlign: "left", fontSize: 14, lineHeight: 1.6 }}
              onMouseEnter={(e) => e.currentTarget.style.display = "block"}
              onMouseLeave={(e) => e.currentTarget.style.display = "none"}>
              <div style={{ fontWeight: 900, fontSize: 16, color: primary, marginBottom: 4 }}>Production Grades <span style={{ fontWeight: 400, fontSize: 13 }}>(number system)</span></div>
              <div style={{ marginBottom: 8, color: "#444", fontSize: 13 }}>Given by <strong>We-Draft.com</strong> editors based on a player's experience, production, and skillset.</div>
              {[
                { grade: "5", color: "#0026ff", desc: 'Best in the country, impact every play. "Early 1st round talent"' },
                { grade: "4", color: "#00a83e", desc: 'High-end starter. "Day 2 talent"' },
                { grade: "3", color: "#eab308", desc: 'Trusted contributor. "Day 3 talent"' },
                { grade: "2", color: "#f97316", desc: "Played some and/or is depth." },
                { grade: "1", color: "#ef4444", desc: "Has not played much." },
                { grade: "W", color: "#000", desc: "Walk-on. Not on scholarship." },
              ].map(({ grade, color, desc }) => (
                <div key={grade} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontWeight: 900, color, minWidth: 20, fontSize: 15 }}>{grade}</span>
                  <span style={{ color: "#333", fontSize: 13 }}>{desc}</span>
                </div>
              ))}
              <div style={{ borderTop: `2px solid ${secondary}`, margin: "14px 0" }} />
              <div style={{ fontWeight: 900, fontSize: 16, color: primary, marginBottom: 4 }}>Development Grades <span style={{ fontWeight: 400, fontSize: 13 }}>(letter system)</span></div>
              <div style={{ marginBottom: 8, color: "#444", fontSize: 13 }}>Given to players with 3+ years of eligibility remaining, based on recruiting rankings and film.</div>
              {[
                { grade: "A+", color: "#f6a21d", desc: "Rare talent, bluechip prospect per We-Draft.com" },
                { grade: "A", color: "#00d9ff", desc: 'Impact potential soon. "5-Star"' },
                { grade: "B", color: "#dc00f0", desc: 'Multiple traits for early contribution. "4-Star"' },
                { grade: "C", color: "#a74300", desc: 'Potential but needs time. "3-Star"' },
                { grade: "D", color: "#850000", desc: "Needs significant development." },
              ].map(({ grade, color, desc }) => (
                <div key={grade} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontWeight: 900, color, minWidth: 20, fontSize: 15 }}>{grade}</span>
                  <span style={{ color: "#333", fontSize: 13 }}>{desc}</span>
                </div>
              ))}
              <div style={{ borderTop: `2px solid ${secondary}`, margin: "14px 0" }} />
              <div style={{ fontWeight: 900, fontSize: 16, color: primary, marginBottom: 6 }}>Community Votes</div>
              <div style={{ color: "#444", fontSize: 13, lineHeight: 1.6 }}>Vote on any player you think <strong>We-Draft.com</strong> is over or underrating. Sign in to your account!</div>
            </div>
          </div>
        </div>

        {/* ===== CURRENT VIEW ===== */}
        {viewMode === "current" && (
          <>
            {renderSection(OFFENSE_POS, "Offense")}
            {renderSection(DEFENSE_POS, "Defense")}

            {rosterYearMode === 2027 && (
              <div style={{ marginTop: 60 }}>
                <SectionHeader>Leaves in 2027</SectionHeader>
                <div style={{ border: `2px solid ${primary}`, borderRadius: 8, overflow: "hidden", backgroundColor: "#fff", maxWidth: 720, margin: "0 auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 140px 60px", backgroundColor: primary, color: "#fff", fontWeight: 900, padding: "14px 18px", fontSize: 16, alignItems: "center" }}>
                    <div>Player</div><div style={{ textAlign: "center" }}>Pos</div><div style={{ textAlign: "center" }}>Reason</div><div />
                  </div>
                  {leavesIn2027.length === 0 ? (
                    <div style={{ padding: 18, fontSize: 16, color: "#666", fontStyle: "italic" }}>No players currently marked as leaving.</div>
                  ) : leavesIn2027.slice().sort((a, b) => (a.Last || "").localeCompare(b.Last || "")).map((p) => {
                    const isDeclared = declaredIds.has(p._id);
                    return (
                      <div key={p._id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 140px 60px", padding: "12px 18px", borderTop: "1px solid #eee", alignItems: "center", fontSize: 16 }}>
                        <div style={{ fontWeight: 900, color: primary }}>{p.First} {p.Last}</div>
                        <div style={{ textAlign: "center", fontWeight: 800 }}>{p.Position || "-"}</div>
                        <div style={{ textAlign: "center", fontWeight: 800, color: isDeclared ? "#b45309" : "#444" }}>{isDeclared ? "Draft" : "Graduates"}</div>
                        <div style={{ textAlign: "center" }}>
                          {isDeclared ? (
                            <button onClick={() => toggleDeclare(p._id)} style={{ background: "#fff", border: `2px solid ${secondary}`, color: "#b91c1c", fontWeight: 900, borderRadius: 6, width: 30, height: 30, cursor: "pointer", fontSize: 16 }}>✕</button>
                          ) : <span style={{ color: "#999" }}>—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== ARCHIVE VIEW ===== */}
        {viewMode === "archive" && (
          <div>
            <SectionHeader>Players Drafted Since 2000</SectionHeader>
            {positionRanks && (
              <div style={{ marginBottom: 30 }}>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ border: `2px solid ${primary}`, borderRadius: 8, overflow: "hidden", backgroundColor: "#fff", marginBottom: 20, minWidth: isMobile ? 500 : "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: `160px repeat(${POSITION_ORDER.length}, 1fr)`, backgroundColor: primary, color: "#fff", fontWeight: 900, padding: "12px 10px", fontSize: 14, textAlign: "center" }}>
                      <div />
                      {POSITION_ORDER.map((pos) => <div key={pos}>{pos}</div>)}
                    </div>
                    {[
                      { label: "Amount", getValue: (pos) => positionCounts[pos] || 0 },
                      { label: "National Rank", getValue: (pos) => positionRanks?.[pos]?.natRank || "-" },
                      { label: `${team?.Conference} Rank`, getValue: (pos) => positionRanks?.[pos]?.confRank || "-" },
                    ].map(({ label, getValue }) => (
                      <div key={label} style={{ display: "grid", gridTemplateColumns: `160px repeat(${POSITION_ORDER.length}, 1fr)`, borderTop: "1px solid #eee", textAlign: "center", fontWeight: 800 }}>
                        <div style={{ padding: 12, textAlign: "left", fontWeight: 900, color: primary, fontSize: 13 }}>{label}</div>
                        {POSITION_ORDER.map((pos) => <div key={pos} style={{ padding: 12 }}>{getValue(pos)}</div>)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <div style={{ border: `2px solid ${primary}`, borderRadius: 8, overflow: "hidden", backgroundColor: "#fff", maxWidth: 1000, margin: "0 auto", minWidth: isMobile ? 600 : "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "80px 100px 1fr 100px 200px", backgroundColor: primary, color: "#fff", fontWeight: 900, padding: "14px 18px", fontSize: 16, alignItems: "center" }}>
                  <div>Year</div><div>Round</div><div>Player</div><div>Pos</div><div>NFL Team</div>
                </div>
                {historical.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 16, color: "#666", fontStyle: "italic" }}>No draft history available.</div>
                ) : historical.slice().sort((a, b) => {
                  if (a.Year !== b.Year) return b.Year - a.Year;
                  if (a.Round !== b.Round) return a.Round - b.Round;
                  return a.Pick - b.Pick;
                }).map((p) => (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: "80px 100px 1fr 100px 200px", padding: "12px 18px", borderTop: "1px solid #eee", alignItems: "center", fontSize: 16 }}>
                    <div style={{ fontWeight: 800 }}>{p.Year}</div>
                    <div style={{ fontWeight: 800 }}>R{p.Round}</div>
                    <div style={{ fontWeight: 900, color: primary }}>{p.Player}</div>
                    <div style={{ textAlign: "center", fontWeight: 800 }}>{p.Position}</div>
                    <div style={{ fontWeight: 700 }}>{p["NFL Team"]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
}