// src/pages/ViewMock.js
//
// /mocks/:mockId/view — a published mock draft, read like a column: the
// author's intro, then one row per pick in the picking team's colors with
// the author's note on that pick — no player grades, it's the author's
// board. The owner gets Share and Edit (CreateMock.jsx) from here.
import { Fragment, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import ShareMockButton from "../components/ShareMockButton";
import { useAuth } from "../context/AuthContext";
import { fetchNflBranding } from "../utils/draftProfileData";
import { textOn } from "../utils/teamColors";
import {
  BLUE, GOLD, INK, MUTED, CARD_SHADOW, BODY_FONT, MOCK_CARD_CSS,
  useIsMobile, MockPageShell, MockHero, heroPill, chip, button, PhoneAd,
} from "../components/MockDraftKit";

// Phones: the Homage card goes after this pick of the round.
const PHONE_AD_AFTER = 5;


export default function ViewMock() {
  const { mockId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [mock, setMock] = useState(null);
  const [teams, setTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeRound, setActiveRound] = useState(1);
  const [ownerLabel, setOwnerLabel] = useState("");

  useEffect(() => { fetchNflBranding().then(setTeams).catch(() => {}); }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "mockDrafts", mockId));
        if (!snap.exists()) return;
        const data = { id: snap.id, ...snap.data() };
        setMock(data);
        if (data.ownerId) {
          const userSnap = await getDoc(doc(db, "users", data.ownerId));
          if (userSnap.exists()) {
            const u = userSnap.data();
            setOwnerLabel(u.username || u.email || "");
          }
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    load();
  }, [mockId]);

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

  if (!mock) return (
    <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 20px", textAlign: "center", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ fontWeight: 900, fontSize: 18, color: BLUE, marginBottom: 16 }}>Mock draft not found.</div>
      <button onClick={() => navigate("/mocks")} style={button("blue", false)}>← All Mocks</button>
    </div>
  );

  const picksArray = Object.values(mock.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);
  const rounds = mock.rounds || 1;
  const availableRounds = [...new Set(picksArray.map((p) => p.round))].sort((a, b) => a - b);
  const roundPicks = picksArray.filter((p) => p.round === activeRound);
  const totalPicks = picksArray.filter((p) => p.selection).length;
  const isOwner = !!(user && mock.ownerId === user.uid);
  const intro = (mock.description || "").trim();
  const updated = mock.updatedAt?.toDate?.()?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // ShareMockButton takes an already-normalized picks shape — here that's
  // just renaming .selection to .player.
  const sharePicks = roundPicks.map((p) => ({ pickNumber: p.pickNumber, currentTeam: p.currentTeam, tradedFrom: p.tradedFrom, player: p.selection }));

  const title = `${mock.name || "Mock Draft"} | We-Draft`;
  const firstPick = picksArray.find((p) => p.selection);
  const description = intro
    ? intro.slice(0, 155) + (intro.length > 155 ? "…" : "")
    : `A ${mock.draftClass || ""} NFL mock draft${ownerLabel ? ` by ${ownerLabel}` : ""}${firstPick ? `, with ${firstPick.selection.First} ${firstPick.selection.Last} at No. ${firstPick.pickNumber}` : ""}.`;
  const url = `https://we-draft.com/mocks/${mockId}/view`;

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
      </Helmet>
      <style>{MOCK_CARD_CSS}</style>

      <MockPageShell year={mock.draftClass || "2027"} isMobile={isMobile}>
        <MockHero
          eyebrow={`${mock.draftClass || ""} Mock Draft`}
          title={mock.name || "Untitled Mock Draft"}
          watermark={mock.draftClass}
          isMobile={isMobile}
          actions={
            <>
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
                  draftClass={mock.draftClass}
                  mockUrl={url}
                />
              )}
              {isOwner && <button onClick={() => navigate(`/mocks/${mockId}`)} style={button("gold", isMobile)}>Edit</button>}
              <button onClick={() => navigate("/mocks")} style={button("ghost", isMobile)}>All Mocks</button>
            </>
          }
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {ownerLabel && (
              <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontFamily: BODY_FONT, marginRight: 4 }}>
                By <strong style={{ color: "#fff" }}>{ownerLabel}</strong>
              </span>
            )}
            <span style={heroPill}>{rounds} Round{rounds !== 1 ? "s" : ""}</span>
            <span style={heroPill}>{totalPicks} Picks</span>
            {mock.visibility !== "public" && <span style={{ ...heroPill, background: "rgba(0,0,0,0.25)" }}>Private</span>}
            {updated && <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)", fontFamily: BODY_FONT }}>Updated {updated}</span>}
          </div>
        </MockHero>

        {/* The author's intro, as the column's lede. */}
        {intro && (
          <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, borderLeft: `5px solid ${GOLD}`, padding: isMobile ? "14px 16px" : "20px 26px", marginBottom: 18 }}>
            {intro.split(/\n{2,}/).map((para, i) => (
              <p key={i} style={{ margin: i ? "12px 0 0" : 0, fontSize: isMobile ? 15 : 17, lineHeight: 1.65, color: "#2a313d", fontFamily: "Georgia, 'Times New Roman', serif", whiteSpace: "pre-line" }}>
                {para}
              </p>
            ))}
          </div>
        )}

        {availableRounds.length > 1 && (
          <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
            {availableRounds.map((r) => (
              <button key={r} role="tab" aria-selected={r === activeRound} onClick={() => setActiveRound(r)} style={{ ...chip(r === activeRound, isMobile), borderRadius: 8 }}>
                {isMobile ? `R${r}` : `Round ${r}`}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roundPicks.map((pick, i) => (
            <Fragment key={pick.pickNumber}>
              <PickRow pick={pick} brand={teams[pick.currentTeam] || {}} isMobile={isMobile} />
              {i === Math.min(PHONE_AD_AFTER, roundPicks.length) - 1 && <PhoneAd isMobile={isMobile} preferTeam={roundPicks[0]?.currentTeam || ""} />}
            </Fragment>
          ))}
        </div>
      </MockPageShell>
    </>
  );
}

// One pick, DraftOrderPage's row: the number on the team's color, then the
// player, the team and the author's note underneath.
function PickRow({ pick, brand, isMobile }) {
  const player = pick.selection;
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const ink = textOn(c1, c2);
  const teamName = brand.Team ? `${brand.City || ""} ${brand.Team}`.trim() : pick.currentTeam;
  const note = pick.note?.trim();
  const logoSize = isMobile ? 36 : 52;

  return (
    <div className="wd-mock-card" style={{ position: "relative", display: "flex", alignItems: "stretch", overflow: "hidden", borderRadius: 14, background: "#fff", boxShadow: CARD_SHADOW }}>
      <span style={{
        flexShrink: 0, width: isMobile ? 54 : 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(160deg, ${c1} 0%, ${c1} 70%, ${c2} 100%)`, color: ink, borderRight: `4px solid ${c2}`,
      }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8 }}>PICK</span>
        <span style={{ fontSize: isMobile ? 22 : 34, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{pick.pickNumber}</span>
      </span>

      <div style={{ position: "relative", flex: 1, minWidth: 0, padding: isMobile ? "10px 12px" : "14px 20px" }}>
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, #fff 45%, ${c1}1a 100%)`, pointerEvents: "none" }} />
        {(brand.Wordmark || brand.WordmarkDark) && (
          <img src={brand.Wordmark || brand.WordmarkDark} alt="" aria-hidden="true" style={{
            position: "absolute", right: isMobile ? -10 : 8, top: isMobile ? 6 : 10, height: isMobile ? 46 : 70,
            maxWidth: isMobile ? "50%" : "40%", objectFit: "contain", opacity: 0.1, pointerEvents: "none",
          }} />
        )}

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 10 : 16 }}>
          <Link to={`/nfl/${String(pick.currentTeam).toLowerCase()}`} title={teamName} style={{ flexShrink: 0, lineHeight: 0 }}>
            {brand.Logo1
              ? <img src={brand.Logo1} alt={teamName} style={{ width: logoSize, height: logoSize, objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.18))" }} />
              : <span style={{ display: "inline-block", width: logoSize }} />}
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <Link to={`/nfl/${String(pick.currentTeam).toLowerCase()}`} style={{ fontSize: 10, fontWeight: 900, color: "#7a8597", letterSpacing: "0.12em", textTransform: "uppercase", textDecoration: "none" }}>
                {teamName}
              </Link>
              {pick.tradedFrom && (
                <span style={{ fontSize: 9, fontWeight: 900, color: "#8a5a00", background: "#fff1d6", border: "1px solid #f6c56b", borderRadius: 999, padding: "2px 7px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Via {pick.tradedFrom}
                </span>
              )}
            </div>
            {player ? (
              <>
                <Link to={`/player/${player.Slug}`} style={{ display: "block", fontSize: isMobile ? 18 : 24, fontWeight: 900, color: INK, textTransform: "uppercase", lineHeight: 1.05, textDecoration: "none", overflowWrap: "anywhere" }}>
                  {player.First} {player.Last}
                </Link>
                <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT, marginTop: 3 }}>
                  {[player.Position, player.School].filter(Boolean).join(" · ")}
                </div>
              </>
            ) : (
              <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "#b0b8c4", fontStyle: "italic" }}>No selection</div>
            )}
          </div>
        </div>

        {note && (
          <p style={{
            position: "relative", margin: isMobile ? "10px 0 0" : "12px 0 0", paddingTop: isMobile ? 8 : 10, borderTop: "1px solid #edf0f5",
            fontSize: isMobile ? 14 : 15, lineHeight: 1.6, color: "#2a313d", fontFamily: "Georgia, 'Times New Roman', serif", whiteSpace: "pre-line",
          }}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
