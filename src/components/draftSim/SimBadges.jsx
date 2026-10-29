// src/components/draftSim/SimBadges.jsx
//
// The Draft Sim's badges on screen (utils/draftSim/badges.js): the badge
// itself (the circle We-Draft logo in a ring of its rarity's color), the
// pop-up when one's earned (BadgeToasts, over the sim), the end screen's
// (EndBadges under the Sim Profile snapshot; signed out, SignUpPanel in
// their place — the account pitch, with the badges they'd keep; RunBadges
// across the top of a Mock Draft's) and the Sim Profile's list of the
// badges earned, by rarity (BadgeShelf).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BADGE_LOGO, RARITIES, rarityOf } from "../../utils/draftSim/badges";
import { PROFILE_PATH } from "../../utils/draftSim/simProfile";

const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";
const FONT = "'Arial Black', Arial, sans-serif";
// How long each pop-up stays up.
const TOAST_MS = 4500;
// The way out.
const LEAVE_MS = 450;
// Rarest first (the end screen).
const rank = (b) => RARITIES.findIndex((r) => r.key === rarityOf(b.rarity).key);
const rarestFirst = (list) => [...list].sort((a, b) => rank(b) - rank(a));
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const HEAD = { padding: "10px 14px", color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.14em", borderBottom: "1px solid #1f2b42" };
// Two lines at most.
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

export function BadgeIcon({ rarity, size = 48 }) {
  const r = rarityOf(rarity);
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, borderRadius: "50%", border: `3px solid ${r.color}`, background: "#0b1322",
      display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: `0 0 10px ${r.color}55`, boxSizing: "border-box",
    }}>
      <img src={BADGE_LOGO} alt="" style={{ width: "84%", height: "84%", objectFit: "contain" }} />
    </span>
  );
}

// The pop-up when a badge is earned, in the sim's colors. Mobile: the
// description wraps to a second line instead of cutting off.
export function BadgeToast({ b, isMobile = false }) {
  const r = rarityOf(b.rarity);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px", background: "linear-gradient(90deg, #0e1626, #14213a)", border: `1px solid ${r.color}`,
      borderRadius: isMobile ? "18px" : "999px", padding: isMobile ? "8px 14px 8px 8px" : "8px 18px 8px 8px", boxShadow: "0 8px 24px rgba(0,0,0,0.35)", fontFamily: FONT, maxWidth: "100%", boxSizing: "border-box",
    }}>
      <BadgeIcon rarity={b.rarity} size={isMobile ? 44 : 48} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: r.color, fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em" }}>BADGE UNLOCKED · {r.label.toUpperCase()}</div>
        <div style={{ color: "#fff", fontSize: "14px", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title || "Badge title"}</div>
        <div style={{ color: "#9fb0c8", fontSize: "11px", fontFamily: BODY, ...(isMobile ? { ...clamp2, lineHeight: 1.3 } : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}>
          {b.description || "What it takes to earn it."}
        </div>
      </div>
    </div>
  );
}

// The queue of pop-ups (useSimBadges' toasts), one at a time at the top
// of the screen, over everything; a tap clears the one showing. Each slides
// down in and eases back up out (LEAVE_MS) before the next.
export function BadgeToasts({ queue, onDone, isMobile }) {
  const b = queue[0];
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setLeaving(false);
    if (!b) return undefined;
    const t = setTimeout(() => setLeaving(true), TOAST_MS);
    return () => clearTimeout(t);
  }, [b]);
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(onDone, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving, onDone]);
  if (!b) return null;
  return (
    <div key={b.id} className={`wd-badge-pop${leaving ? " out" : ""}`} onClick={() => setLeaving(true)} role="status" style={{
      position: "fixed", top: isMobile ? "calc(8px + env(safe-area-inset-top))" : 92, left: "50%", transform: "translateX(-50%)", zIndex: 10003,
      width: isMobile ? "calc(100vw - 24px)" : "max-content", maxWidth: isMobile ? 420 : "calc(100vw - 24px)", cursor: "pointer",
    }}>
      <style>{`@keyframes wdBadgeIn{0%{opacity:0;transform:translateY(-16px) scale(.96)}100%{opacity:1;transform:none}}
@keyframes wdBadgeOut{0%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-20px) scale(.94)}}
.wd-badge-pop>div{animation:wdBadgeIn .35s ease-out both}
.wd-badge-pop.out>div{animation:wdBadgeOut ${LEAVE_MS}ms cubic-bezier(.4,0,.2,1) both}`}</style>
      <BadgeToast b={b} isMobile={isMobile} />
    </div>
  );
}

// A Mock Draft's end screen: the badges this draft unlocked, across the
// top. Signed out: sign in to keep them.
export function RunBadges({ badges, signedIn, login }) {
  if (!badges.length) return null;
  return (
    <div style={{ background: "#0e1626", border: `1px solid ${GOLD}`, borderRadius: 14, padding: "10px 14px", marginBottom: 12, fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", marginRight: "auto" }}>
          {badges.length} BADGE{badges.length === 1 ? "" : "S"} UNLOCKED THIS DRAFT
        </span>
        {!signedIn && (
          <button onClick={login} style={{ border: "none", borderRadius: 8, background: GOLD, color: "#fff", padding: "7px 14px", fontWeight: 900, fontSize: 11, letterSpacing: "0.06em", cursor: "pointer", fontFamily: FONT }}>
            SIGN IN TO KEEP THEM
          </button>
        )}
      </div>
      {!signedIn && <div style={{ color: "#9fb0c8", fontSize: 12, fontFamily: BODY, marginBottom: 8 }}>Badges only stay on your Sim Profile with a free account — sign in now and this draft&apos;s count.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {rarestFirst(badges).map((b) => <BadgeRow key={b.id} b={b} />)}
      </div>
    </div>
  );
}

// The end screen, signed in, under the profile snapshot: this draft's
// badges, rarest first — as many as fit (max), the rest a count and a way
// to the profile.
export function EndBadges({ badges, max = 4 }) {
  const list = rarestFirst(badges);
  const more = list.length - max;
  return (
    <div style={PANEL}>
      <div style={{ ...HEAD, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>BADGES THIS DRAFT</span>
        {list.length > 0 && <span style={{ color: GOLD }}>+{list.length}</span>}
      </div>
      {list.length ? (
        <div style={{ padding: 10, display: "grid", gap: 6 }}>
          {list.slice(0, max).map((b) => <BadgeRow key={b.id} b={b} compact />)}
          {more > 0 && <Link to={PROFILE_PATH} style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textDecoration: "none", padding: "4px 4px 0" }}>+{more} MORE ON YOUR PROFILE →</Link>}
        </div>
      ) : (
        <div style={{ padding: "10px 14px", color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>
          No new badges this draft — <Link to={PROFILE_PATH} style={{ color: GOLD, textDecoration: "none", fontWeight: 700 }}>see the ones you&apos;ve earned</Link>.
        </div>
      )}
    </div>
  );
}

// The end screen, signed out, in the profile snapshot's place: what a free
// account keeps — this draft's badges first, when it earned any (as many
// as fit, rarest first) — and the button. Signing in from here counts
// this draft (DraftSim.jsx). total: how many badges there are to earn.
const PERKS = ["Every badge you earn, saved", "Your daily streak & average grade", "Your teams, positions and best picks"];
// signup: the Create Account button (the auth modal on its signup screen); login: "Sign in".
export function SignUpPanel({ badges, total, login, signup = login, max = 3 }) {
  const list = rarestFirst(badges);
  const more = list.length - max;
  return (
    <div style={{ ...PANEL, border: `1px solid ${GOLD}`, background: "linear-gradient(180deg, rgba(246,162,29,0.12), rgba(246,162,29,0) 55%), #0e1626", fontFamily: FONT, minWidth: 0 }}>
      <div style={{ padding: "16px 16px 4px" }}>
        <div style={{ color: GOLD, fontSize: 10, fontWeight: 900, letterSpacing: "0.16em" }}>FREE SIM PROFILE</div>
        <div style={{ color: "#fff", fontSize: 20, fontWeight: 900, lineHeight: 1.15, marginTop: 4 }}>
          {list.length ? `Keep the ${list.length === 1 ? "badge" : `${list.length} badges`} you just unlocked` : "Don't let this draft disappear"}
        </div>
        <div style={{ color: "#9fb0c8", fontSize: 12, fontFamily: BODY, lineHeight: 1.45, marginTop: 6 }}>
          {list.length
            ? "They're gone when you leave this page unless you sign in. It's free, and this draft counts the moment you do."
            : `Sign in and this draft goes on your Sim Profile${total ? ` — with ${total} badges to unlock` : ""}.`}
        </div>
      </div>
      {list.length > 0 && (
        <div style={{ padding: "10px 12px 0", display: "grid", gap: 6 }}>
          {list.slice(0, max).map((b) => <BadgeRow key={b.id} b={b} compact />)}
          {more > 0 && <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", padding: "2px 4px 0" }}>+{more} MORE</div>}
        </div>
      )}
      <div style={{ padding: "12px 16px 0", display: "grid", gap: 5 }}>
        {PERKS.map((t) => (
          <div key={t} style={{ display: "flex", gap: 8, alignItems: "center", color: "#dbe4f0", fontSize: 12, fontFamily: BODY }}>
            <span style={{ color: "#3fb950", fontWeight: 900 }}>✓</span>{t}
          </div>
        ))}
      </div>
      <div style={{ padding: 16 }}>
        <button onClick={signup} style={{ width: "100%", border: "none", borderRadius: 999, background: GOLD, color: "#fff", padding: "12px 16px", fontWeight: 900, fontSize: 13, letterSpacing: "0.08em", cursor: "pointer", fontFamily: FONT, boxShadow: "0 6px 18px rgba(246,162,29,0.25)" }}>
          {list.length ? "SIGN UP & KEEP THEM" : "CREATE FREE ACCOUNT"}
        </button>
        <div style={{ textAlign: "center", marginTop: 8, color: "#8b9bb4", fontSize: 11, fontFamily: BODY }}>
          Already have one?{" "}
          <button onClick={login} style={{ border: "none", background: "none", padding: 0, color: "#fff", fontWeight: 700, fontSize: 11, fontFamily: BODY, cursor: "pointer", textDecoration: "underline" }}>Sign in</button>
        </div>
      </div>
    </div>
  );
}

// compact: the description held to two lines. sectioned: under its
// rarity's heading already (the profile) — no rarity tag.
function BadgeRow({ b, note, compact = false, sectioned = false }) {
  const r = rarityOf(b.rarity);
  return (
    <div title={b.description} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 10, background: "#121c2f", border: `1px solid ${r.color}66`, minWidth: 0 }}>
      <BadgeIcon rarity={b.rarity} size={compact ? 34 : 38} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {b.title}{!sectioned && <> <span style={{ color: r.color, fontSize: 9, letterSpacing: "0.1em" }}>{r.label.toUpperCase()}</span></>}
        </div>
        <div style={{ color: "#9fb0c8", fontSize: 11, fontFamily: BODY, lineHeight: 1.3, ...(compact ? clamp2 : {}) }}>{b.description}</div>
        {note && <div style={{ color: "#6f7f99", fontSize: 10, fontFamily: BODY, marginTop: 1 }}>{note}</div>}
      </div>
    </div>
  );
}

// The Sim Profile: the badges the user's earned (badges: loadBadges';
// earned: loadEarned's), by rarity, commonest first — every rarity, a 0
// for one with none yet; panel / head: the profile's panel styles.
export function BadgeShelf({ badges, earned, panel, head }) {
  const got = Object.values(badges).filter((b) => earned[b.id]);
  const day = (e) => (e?.at?.toDate ? e.at.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
  const groups = RARITIES.map((r) => ({ ...r, list: got.filter((b) => rarityOf(b.rarity).key === r.key) }));
  return (
    <div style={panel}>
      <div style={{ ...head, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>BADGES EARNED</span>
        <span style={{ color: GOLD }}>{got.length}</span>
      </div>
      {groups.map((c, i) => (
        <div key={c.key} style={{ padding: "8px 10px 10px", borderTop: i ? "1px solid #18233a" : "none" }}>
          <div style={{ color: c.color, fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", margin: "0 4px 6px" }}>{c.label.toUpperCase()} · {c.list.length}</div>
          {c.list.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 6 }}>
              {c.list.map((b) => <BadgeRow key={b.id} b={b} sectioned note={[day(earned[b.id]), earned[b.id].year && `${earned[b.id].year} class`].filter(Boolean).join(" · ")} />)}
            </div>
          ) : <div style={{ color: "#5c6b85", fontSize: 11, fontFamily: BODY, margin: "0 4px" }}>None yet</div>}
        </div>
      ))}
    </div>
  );
}
