// src/components/RankedSwap.js
//
// "Your Ranked 6 is full" — the swap chooser shown when a 7th pick would be
// ranked (utils/wePickRanked.js): starring one more in We-Pick's My Picks
// (WePickHub.js, as a modal) or after a new pick on a game page saves
// unranked because the week was full (LivePage.js PreviewPickCard, inline).
// Lists the week's ranked picks; "Swap out" on one un-ranks it and ranks the
// new pick in one batch. A pick whose game has kicked off can't be swapped
// out (it's locked). Each row warns when swapping it out would leave the
// Ranked 6 short of a requirement (the Game of the Week, 2 Featured).
import { isPickable } from "../utils/wePickLocks";
import { rankedNeeds } from "../utils/wePickRanked";

const GOLD = "#f6a21d";

export const RANKED_SWAP_STYLE = `
.rsw { background: #0c1220; border: 1px solid #3a4a6a; border-radius: 14px; padding: 14px; color: #eef2f8; text-align: left; }
.rsw-h { font-weight: 900; font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; }
.rsw-sub { margin: 4px 0 10px; font-size: 13px; font-weight: 700; color: #9fb0c8; line-height: 1.4; }
.rsw-sub b { color: ${GOLD}; }
.rsw-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; background: #111a2b; border: 1px solid #1d2840; margin-bottom: 6px; }
.rsw-row .g { flex: 1; min-width: 0; }
.rsw-row .m { font-weight: 900; font-size: 14px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rsw-row .p { font-size: 12px; font-weight: 800; color: #9fb0c8; margin-top: 2px; }
.rsw-tag { display: inline-block; font-size: 9px; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; margin-left: 6px; color: #fff; vertical-align: 1px; }
.rsw-tag.gotw { background: #7c3aed; }
.rsw-tag.feat { background: ${GOLD}; color: #121212; }
.rsw-warn { font-size: 11px; font-weight: 800; color: #ffb36b; margin-top: 3px; }
.rsw-row button { flex-shrink: 0; background: ${GOLD}; color: #121212; border: 0; border-radius: 999px; padding: 7px 12px; font-weight: 900; font-size: 12px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.rsw-row button:disabled { background: #26324a; color: #6f819c; cursor: default; }
.rsw-foot { display: flex; justify-content: flex-end; margin-top: 8px; }
.rsw-foot button { background: none; border: 1px solid #3a4a6a; color: #c9d5e6; border-radius: 999px; padding: 6px 14px; font-weight: 800; font-size: 12px; cursor: pointer; font-family: inherit; }
.rsw-modal { position: fixed; inset: 0; z-index: 10060; background: rgba(4,8,16,0.72); display: flex; align-items: center; justify-content: center; padding: 16px; }
.rsw-modal .rsw { width: min(460px, 100%); max-height: calc(100vh / var(--pz, 1) - 32px); overflow-y: auto; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
`;

const matchup = (g) => `${g.Away} @ ${g.Home}`;

// ranked: [{ id, game, pick }] — the week's ranked picks (game: schedule26
// shaped, pick: { awayScore, homeScore }). inGame: the pick waiting to be
// ranked. onSwap(outId) does the write; busyId: the row being swapped.
export default function RankedSwap({ ranked, inGame, week, onSwap, onCancel, busyId, modal = false }) {
  const body = (
    <div className="rsw" role="dialog" aria-label="Your Ranked 6 is full" onClick={(e) => e.stopPropagation()}>
      <style>{RANKED_SWAP_STYLE}</style>
      <div className="rsw-h">🏆 Your Ranked 6 is full</div>
      <div className="rsw-sub">
        Your pick on <b>{matchup(inGame)}</b> is saved but not ranked. Swap one of your ranked picks out to rank it instead:
      </div>
      {ranked.map(({ id, game, pick }) => {
        const locked = !isPickable(game);
        // What the Ranked 6 would be missing with this one swapped out.
        const after = [...ranked.filter((r) => r.id !== id).map((r) => r.game), ...(inGame.RankedDisqualified ? [] : [inGame])];
        const lost = rankedNeeds(after, week).filter((n) => !rankedNeeds(ranked.map((r) => r.game), week).includes(n));
        return (
          <div key={id} className="rsw-row">
            <div className="g">
              <div className="m">
                {matchup(game)}
                {game.GameOfWeek && <span className="rsw-tag gotw">GOTW</span>}
                {game.Featured && <span className="rsw-tag feat">Featured</span>}
              </div>
              <div className="p">Your pick: {pick.awayScore}–{pick.homeScore}{locked ? " · Locked (kicked off)" : ""}</div>
              {!locked && lost.length > 0 && <div className="rsw-warn">⚠ You'd still need {lost.join(" and ")} to qualify.</div>}
            </div>
            <button type="button" disabled={locked || !!busyId} onClick={() => onSwap(id)}>
              {busyId === id ? "Swapping…" : "Swap out"}
            </button>
          </div>
        );
      })}
      <div className="rsw-foot"><button type="button" onClick={onCancel}>Keep it unranked</button></div>
    </div>
  );
  return modal ? <div className="rsw-modal" onClick={onCancel}>{body}</div> : body;
}
