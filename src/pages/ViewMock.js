import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";
import ShareMockButton from "../components/ShareMockButton";
import { useAuth } from "../context/AuthContext";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Same drift/spotlight treatment as the team/game/We-Pick heroes elsewhere
// on the site (each page injects its own copy — CSS-in-JS here is scoped
// per-component, not shared) — gives this page the same "family" feel
// instead of the old plain white header it used to have.
const VIEWMOCK_HERO_STYLE = `
  @keyframes wdMockHeroDrift {
    0%   { transform: translate(0, 0); }
    100% { transform: translate(-80px, -46px); }
  }
  @keyframes wdMockHeroSpotlight {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }
  .wd-mock-row {
    transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  }
  .wd-mock-row:hover {
    transform: translateX(4px);
    box-shadow: 0 4px 14px rgba(0,0,0,0.1);
  }
  .wd-mock-round-tab {
    transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
  }
  .wd-mock-round-tab:hover {
    transform: translateY(-2px);
  }
`;

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

export default function ViewMock() {
  const { mockId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mock, setMock] = useState(null);
  const [teams, setTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeRound, setActiveRound] = useState(1);
  const [ownerLabel, setOwnerLabel] = useState("");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "mockDrafts", mockId));
        if (!snap.exists()) { setLoading(false); return; }
        const data = { id: snap.id, ...snap.data() };
        setMock(data);

        // Load NFL teams
        const { getDocs, collection } = await import("firebase/firestore");
        const teamSnap = await getDocs(collection(db, "nfl"));
        const teamMap = {};
        teamSnap.forEach((t) => (teamMap[t.id] = t.data()));
        setTeams(teamMap);

        // Load owner name
        if (data.ownerId) {
          const userSnap = await getDoc(doc(db, "users", data.ownerId));
          if (userSnap.exists()) {
            const u = userSnap.data();
            setOwnerLabel(u.username || u.email || data.ownerId);
          }
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    load();
  }, [mockId]);

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (!mock) return (
    <div style={{ maxWidth: "600px", margin: "80px auto", padding: "0 20px", textAlign: "center", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ fontWeight: 900, fontSize: "18px", color: BLUE, marginBottom: "16px" }}>Mock draft not found.</div>
      <button onClick={() => navigate("/mocks")} style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "10px 24px", fontWeight: 900, fontSize: "14px", textTransform: "uppercase", cursor: "pointer" }}>
        ← Mock Hub
      </button>
    </div>
  );

  // Build picks array sorted by pick number
  const picksArray = Object.values(mock.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);
  const rounds = mock.rounds || 1;
  const availableRounds = [...new Set(picksArray.map((p) => p.round))].sort((a, b) => a - b);
  const roundPicks = picksArray.filter((p) => p.round === activeRound);
  const totalPicks = picksArray.filter((p) => p.selection).length;
  const isOwner = !!(user && mock.ownerId === user.uid);
  // ShareMockButton takes an already-normalized picks shape — here that's
  // just renaming .selection to .player, since this page's own picks are
  // already otherwise in that shape.
  const sharePicks = roundPicks.map((p) => ({ pickNumber: p.pickNumber, currentTeam: p.currentTeam, tradedFrom: p.tradedFrom, player: p.selection }));

  return (
    <>
      <Helmet><title>{mock.name || "Mock Draft"} | We-Draft</title></Helmet>
      <style>{VIEWMOCK_HERO_STYLE}</style>

      <div ref={contentRef} style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Hero ===== */}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: "16px",
          border: `2px solid ${GOLD}`, marginBottom: "22px",
          boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
          background: [
            "linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38))",
            `linear-gradient(120deg, ${BLUE} 0%, ${BLUE} 60%, #003a7a 100%)`,
          ].join(", "),
          padding: isMobile ? "20px 16px" : "28px 32px",
        }}>
          {/* Animated overlay layers — see VIEWMOCK_HERO_STYLE above */}
          <div aria-hidden="true" style={{
            position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)",
            animation: "wdMockHeroDrift 18s linear infinite",
          }} />
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.16), transparent 55%)",
            animation: "wdMockHeroSpotlight 5s ease-in-out infinite",
          }} />
          {/* Two soft gold corner glows, top-left/bottom-right, same fixed-
              radius "leak" convention GamePage.js's own hero uses. */}
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            background: [
              `radial-gradient(circle ${isMobile ? 120 : 220}px at top left, ${GOLD}44, transparent 100%)`,
              `radial-gradient(circle ${isMobile ? 120 : 220}px at bottom right, ${GOLD}44, transparent 100%)`,
            ].join(", "),
          }} />
          {/* Giant faded draft-class watermark, hidden on mobile — same
              oversized-background-graphic idea as team/game hero wordmarks,
              just typographic since a mock draft has no logo of its own. */}
          {!isMobile && (
            <div aria-hidden="true" style={{
              position: "absolute", top: "50%", right: "-2%", transform: "translateY(-50%) rotate(-6deg)",
              fontSize: "150px", fontWeight: 900, color: "rgba(255,255,255,0.07)",
              letterSpacing: "0.02em", whiteSpace: "nowrap", zIndex: 0, pointerEvents: "none",
            }}>
              {mock.draftClass || ""}
            </div>
          )}

          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
              <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "18px" : "22px", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
              <div style={{ fontSize: "12px", fontWeight: 800, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                Mock Draft
              </div>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto", flexWrap: "wrap" }}>
                {/* Edit and Share only make sense for the mock's own owner
                    — a visitor viewing someone else's public mock would
                    just get bounced right back to this same read-only view
                    from Edit anyway (CreateMock.jsx gates on isOwner too),
                    and sharing someone else's mock isn't this button's job. */}
                {isOwner && (
                  <ShareMockButton
                    mockName={mock.name}
                    ownerLabel={ownerLabel}
                    roundLabel={`Round ${activeRound}`}
                    totalRounds={rounds}
                    visibility={mock.visibility}
                    picks={sharePicks}
                    teams={teams}
                    filenamePrefix={`WeDraft_${(mock.name || "MockDraft").replace(/\s+/g, "")}_Rd${activeRound}`}
                  />
                )}
                {isOwner && (
                  <button
                    onClick={() => navigate(`/mocks/${mockId}`)}
                    style={{
                      background: GOLD, color: "#fff", border: "2px solid #fff", borderRadius: "8px",
                      padding: isMobile ? "7px 14px" : "8px 18px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                      boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
                    }}
                  >
                    Edit →
                  </button>
                )}
                <button
                  onClick={() => navigate("/mocks")}
                  style={{
                    background: "rgba(255,255,255,0.12)", color: "#fff", border: "2px solid #fff", borderRadius: "8px",
                    padding: isMobile ? "7px 14px" : "8px 18px", fontWeight: 900, fontSize: "12px",
                    textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                  }}
                >
                  Hub
                </button>
              </div>
            </div>

            <div style={{
              fontSize: isMobile ? "clamp(20px, 7vw, 30px)" : "clamp(30px, 3.4vw, 44px)", fontWeight: 900, color: "#fff",
              lineHeight: 1.08, letterSpacing: "0.01em", textTransform: "uppercase", wordBreak: "break-word",
              textShadow: "0 2px 8px rgba(0,0,0,0.4)", marginBottom: "14px",
            }}>
              {mock.name || "Untitled Mock Draft"}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {ownerLabel && (
                <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>
                  By <span style={{ color: "#fff", fontWeight: 900 }}>{ownerLabel}</span>
                </div>
              )}
              <span style={{ display: "inline-block", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: "11px", fontWeight: 800, padding: "4px 12px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {rounds} Round{rounds !== 1 ? "s" : ""}
              </span>
              <span style={{ display: "inline-block", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: "11px", fontWeight: 800, padding: "4px 12px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {totalPicks} Picks Made
              </span>
              {mock.visibility === "public" && (
                <span style={{ display: "inline-block", background: GOLD, color: "#fff", fontSize: "11px", fontWeight: 900, padding: "4px 12px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  🌍 Public
                </span>
              )}
              {mock.updatedAt?.toDate && (
                <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>
                  Updated {mock.updatedAt.toDate().toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Round tabs ===== */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
          {availableRounds.map((r) => {
            const active = activeRound === r;
            return (
              <button
                key={r}
                className="wd-mock-round-tab"
                onClick={() => setActiveRound(r)}
                style={{
                  padding: isMobile ? "7px 16px" : "9px 22px",
                  fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  border: `2px solid ${GOLD}`, borderRadius: "20px", cursor: "pointer",
                  background: active ? GOLD : "#fff",
                  color: active ? "#fff" : BLUE,
                  boxShadow: active ? "0 4px 12px rgba(246,162,29,0.4)" : "none",
                }}
              >
                Round {r}
              </button>
            );
          })}
        </div>

        {/* ===== Picks card ===== */}
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden", boxShadow: "0 6px 18px rgba(0,0,0,0.08)" }}>
          <div style={{ background: `linear-gradient(90deg, ${BLUE}, #003a7a)`, padding: "10px 18px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              🏈 Round {activeRound}
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {roundPicks.map((pick, i) => {
            const team = teams[pick.currentTeam];
            const player = pick.selection;
            const teamColor1 = team?.Color1 || BLUE;
            const teamColor2 = team?.Color2 || GOLD;
            // Dark variant preferred — this now sits directly on the row's
            // own Color1 fill as a background watermark instead of inside
            // a white boxed card, same dark-background-friendly convention
            // used everywhere else on the site.
            const teamLogo = team?.LogoDark || team?.Logo1 || null;
            const teamName = team ? `${team.City} ${team.Team}` : pick.currentTeam;
            const hasPick = !!player;

            return (
              <div
                key={pick.pickNumber}
                className="wd-mock-row"
                style={{
                  position: "relative", overflow: "hidden",
                  display: "flex", alignItems: "center",
                  padding: isMobile ? "10px 12px" : "14px 18px",
                  borderBottom: i < roundPicks.length - 1 ? `1px solid ${hasPick ? "rgba(255,255,255,0.25)" : "#f0f0f0"}` : "none",
                  borderLeft: `5px solid ${hasPick ? teamColor2 : "#e8e8e8"}`,
                  // Solid fill of the picking team's own Color1 — this is
                  // meant to feel like "the Raiders' pick," not just a pick
                  // that happens to list a team, the same way a broadcast
                  // draft tracker color-codes each selection to the team
                  // that made it.
                  background: hasPick ? teamColor1 : "#fff",
                }}
              >
                {/* Team logo (or, failing that, initials) as a huge,
                    barely-there background graphic — same "oversized
                    background watermark" idea as the hero's own draft-class
                    watermark above, just per-row and per-team, instead of
                    sitting in its own small boxed card. Sits contained in
                    the open space on the right, right after where the
                    team/player text ends, rather than bleeding off either
                    edge (which either hid behind the pick badge on the left
                    or ran under the trade note on the right). */}
                {hasPick && (
                  teamLogo ? (
                    <img
                      src={sanitizeUrl(teamLogo)} alt="" aria-hidden="true" loading="lazy"
                      style={{
                        position: "absolute", top: "50%", right: "16px", transform: "translateY(-50%)",
                        height: isMobile ? "90%" : "120%", width: "auto", maxWidth: isMobile ? "80px" : "140px",
                        objectFit: "contain", opacity: 0.18, pointerEvents: "none",
                      }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <div aria-hidden="true" style={{
                      position: "absolute", top: "50%", right: "16px", transform: "translateY(-50%)",
                      fontSize: isMobile ? "30px" : "48px", fontWeight: 900, color: "rgba(255,255,255,0.14)",
                      letterSpacing: "0.02em", lineHeight: 1, pointerEvents: "none", whiteSpace: "nowrap",
                    }}>
                      {pick.currentTeam}
                    </div>
                  )
                )}

                {/* Pick number badge — white now, so it still reads as its
                    own distinct badge instead of disappearing into a row
                    that's the same Color1 fill. */}
                <div style={{
                  position: "relative", zIndex: 1,
                  flexShrink: 0, width: isMobile ? "44px" : "60px", height: isMobile ? "44px" : "60px",
                  borderRadius: "8px", background: hasPick ? "#fff" : teamColor1,
                  border: `2px solid ${teamColor2}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  marginRight: isMobile ? "10px" : "14px", opacity: hasPick ? 1 : 0.55,
                  boxShadow: hasPick ? "0 3px 10px rgba(0,0,0,0.2)" : "none",
                }}>
                  <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 900, color: hasPick ? teamColor1 : "#fff", lineHeight: 1 }}>{pick.pickNumber}</div>
                  <div style={{ fontSize: "8px", fontWeight: 800, color: hasPick ? `${teamColor1}bb` : "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pick</div>
                </div>

                {/* Team / player info — team identity still leads (this is
                    fundamentally "the [Team]'s pick" before it's whoever
                    they took), just as plain bold text now instead of its
                    own boxed badge. */}
                <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                    <span style={{
                      color: hasPick ? "#fff" : teamColor1, fontSize: isMobile ? "11px" : "12px", fontWeight: 900,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      textShadow: hasPick ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                    }}>
                      {teamName}
                    </span>
                    {pick.tradedFrom && (
                      <span style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontWeight: 700, fontSize: "9px", padding: "2px 7px", borderRadius: "8px" }}>
                        via {pick.tradedFrom}
                      </span>
                    )}
                  </div>
                  {hasPick ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <Link
                        to={`/player/${player.Slug}`}
                        style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "15px" : "20px", textDecoration: "none", lineHeight: 1.2, textShadow: "0 1px 4px rgba(0,0,0,0.35)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                      >
                        {player.First} {player.Last}
                      </Link>
                      {player.Position && (
                        <span style={{ background: "#fff", color: teamColor1, fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "10px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
                          {player.Position}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 800, color: "#bbb", fontStyle: "italic" }}>
                      On the clock…
                    </div>
                  )}
                  {hasPick && player.School && (
                    <div style={{ fontSize: isMobile ? "11px" : "13px", fontWeight: 700, color: "rgba(255,255,255,0.85)", marginTop: "2px" }}>
                      {player.School}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} />
    </>
  );
}
