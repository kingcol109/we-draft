// src/utils/voice/cfbdRows.js
//
// /voice: every college player on a CFBD roster, compact, so a name that
// isn't on We-Draft.com's board can still be found (user, 2026-11-25: "a lot
// of players won't be on We-Draft — if somebody asks for John Doe's stats,
// it should play"). No imports: scripts/buildCfbdPeople.mjs uses it too.
//
// compSnapshots/_cfbdPeople:   { version, parts, total, teams: [[teamId, school], …] }
// compSnapshots/_cfbdPeople_N: { version, text: rows joined by newlines,
//   each "cfbdId|first|last|pos|teamIndex|onWeDraft" } — one string, since an
//   array this long is over Firestore's index-entry limit.
// onWeDraft is "1" when the roster row is linked to a We-Draft.com profile.
export const SEP = "|";
const clean = (s) => String(s ?? "").split(SEP).join(" ").trim();

/** cfbRosters docs → { teams, rows } */
export function cfbdPeopleRows(rosters) {
  const teams = [];
  const rows = [];
  rosters.forEach((r) => {
    if (!r?.players?.length || r.teamId == null) return;
    const t = teams.length;
    teams.push([r.teamId, r.school || r.team || ""]);
    r.players.forEach((p) => {
      if (!p?.id || !(p.first || p.last)) return;
      rows.push([clean(p.id), clean(p.first), clean(p.last), clean(p.pos), t, p.slug ? "1" : ""].join(SEP));
    });
  });
  return { teams, rows };
}

/** One row back → { cfbd, first, last, cfbdPos, teamId, school, onWeDraft } */
export function decodeCfbdRow(row, teams) {
  const [cfbd, first, last, cfbdPos, t, w] = String(row).split(SEP);
  const [teamId, school] = teams[Number(t)] || [null, ""];
  return { cfbd, first, last, cfbdPos, teamId, school, onWeDraft: w === "1" };
}
