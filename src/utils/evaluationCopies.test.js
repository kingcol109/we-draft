import { canonicalEvalData } from "./evaluationCopies";

const base = {
  uid: "u1", playerId: "p1", playerName: "Test Player", grade: "Second Round",
  strengths: ["Speed"], weaknesses: ["Blocking"], nflFit: "Jets",
  evaluation: "Written take", gameNotes: [{ gameId: "g1", note: "n" }], updatedAt: 1,
};

test("public eval keeps its text and structured fields, drops email", () => {
  const out = canonicalEvalData({ ...base, email: "a@b.com", visibility: "public" });
  expect(out).toEqual({ ...base, visibility: "public" });
});

test("private eval keeps only structured aggregate fields", () => {
  const out = canonicalEvalData({ ...base, email: "a@b.com", visibility: "private" });
  expect(out).toEqual({
    uid: "u1", playerId: "p1", playerName: "Test Player", grade: "Second Round",
    strengths: ["Speed"], weaknesses: ["Blocking"], nflFit: "Jets", visibility: "private", updatedAt: 1,
  });
});

test("missing visibility is treated as private", () => {
  const out = canonicalEvalData({ ...base });
  expect(out.evaluation).toBeUndefined();
  expect(out.gameNotes).toBeUndefined();
  expect(out.grade).toBe("Second Round");
});

test("does not mutate the input (the mirror copy keeps everything)", () => {
  const input = { ...base, email: "a@b.com", visibility: "private" };
  canonicalEvalData(input);
  expect(input.evaluation).toBe("Written take");
  expect(input.email).toBe("a@b.com");
});
