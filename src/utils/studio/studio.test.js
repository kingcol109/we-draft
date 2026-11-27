import { parsePrproj, TICKS, baseName } from "./prproj";
import { relativeParts } from "./filmFolder";
import { assetAt, autoAssign, chaptersText, defaultMarks, filmAt, filmLayout, markOrder, overlayViewAt, segmentAt } from "./timeline";

// A tiny project shaped like a real one: a sequence with two plays from two
// games (the second one a nested sequence holding a play and a still).
const T = (s) => String(Math.round(s * TICKS));
const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <MasterClip ObjectUID="mc1"><Name>kromah 2026</Name><Clips><Clip Index="0" ObjectRef="90"/></Clips></MasterClip>
  <VideoClip ObjectID="90"><Clip><Source ObjectRef="91"/></Clip></VideoClip>
  <VideoSequenceSource ObjectID="91"><SequenceSource><Sequence ObjectURef="seqA"/></SequenceSource></VideoSequenceSource>
  <Sequence ObjectUID="seqA"><TrackGroups><TrackGroup Index="0"><Second ObjectRef="10"/></TrackGroup></TrackGroups></Sequence>
  <VideoTrackGroup ObjectID="10"><TrackGroup><Tracks><Track Index="0" ObjectURef="trk1"/></Tracks><FrameRate>8475667200</FrameRate></TrackGroup></VideoTrackGroup>
  <VideoClipTrack ObjectUID="trk1"><ClipTrack><ClipItems><TrackItems><TrackItem Index="0" ObjectRef="20"/><TrackItem Index="1" ObjectRef="21"/></TrackItems></ClipItems></ClipTrack></VideoClipTrack>
  <VideoClipTrackItem ObjectID="20"><ClipTrackItem><TrackItem><End>${T(8)}</End></TrackItem><SubClip ObjectRef="30"/></ClipTrackItem></VideoClipTrackItem>
  <VideoClipTrackItem ObjectID="21"><ClipTrackItem><TrackItem><Start>${T(8)}</Start><End>${T(18)}</End></TrackItem><SubClip ObjectRef="31"/></ClipTrackItem></VideoClipTrackItem>
  <SubClip ObjectID="30"><Clip ObjectRef="40"/><Name>FSU O VS. CLEMSON D.mp4</Name></SubClip>
  <SubClip ObjectID="31"><Clip ObjectRef="41"/><Name>Nested Sequence 01</Name></SubClip>
  <VideoClip ObjectID="40"><Clip><Source ObjectRef="50"/><OutPoint>${T(108)}</OutPoint><InPoint>${T(100)}</InPoint></Clip></VideoClip>
  <VideoClip ObjectID="41"><Clip><Source ObjectRef="51"/><OutPoint>${T(10)}</OutPoint><InPoint>${T(0)}</InPoint></Clip></VideoClip>
  <VideoMediaSource ObjectID="50"><MediaSource><Media ObjectURef="m1"/></MediaSource></VideoMediaSource>
  <Media ObjectUID="m1"><ActualMediaFilePath>C:\\KC Holdings\\KC Entertainment\\All22 store\\FSU O VS. CLEMSON D.mp4</ActualMediaFilePath></Media>
  <VideoSequenceSource ObjectID="51"><SequenceSource><Sequence ObjectURef="seqB"/></SequenceSource></VideoSequenceSource>
  <Sequence ObjectUID="seqB"><TrackGroups><TrackGroup Index="0"><Second ObjectRef="11"/></TrackGroup></TrackGroups></Sequence>
  <VideoTrackGroup ObjectID="11"><TrackGroup><Tracks><Track Index="0" ObjectURef="trk2"/><Track Index="1" ObjectURef="trk3"/></Tracks><FrameRate>8475667200</FrameRate></TrackGroup></VideoTrackGroup>
  <VideoClipTrack ObjectUID="trk2"><ClipTrack><ClipItems><TrackItems><TrackItem Index="0" ObjectRef="22"/></TrackItems></ClipItems></ClipTrack></VideoClipTrack>
  <VideoClipTrack ObjectUID="trk3"><ClipTrack><ClipItems><TrackItems><TrackItem Index="0" ObjectRef="23"/></TrackItems></ClipItems></ClipTrack></VideoClipTrack>
  <VideoClipTrackItem ObjectID="22"><ClipTrackItem><TrackItem><End>${T(10)}</End></TrackItem><SubClip ObjectRef="32"/></ClipTrackItem></VideoClipTrackItem>
  <VideoClipTrackItem ObjectID="23"><ClipTrackItem><TrackItem><End>${T(2)}</End></TrackItem><SubClip ObjectRef="33"/></ClipTrackItem></VideoClipTrackItem>
  <SubClip ObjectID="32"><Clip ObjectRef="42"/><Name>LOUISVILLE.mp4</Name></SubClip>
  <SubClip ObjectID="33"><Clip ObjectRef="43"/><Name>circle.png</Name></SubClip>
  <VideoClip ObjectID="42"><Clip><Source ObjectRef="52"/><OutPoint>${T(526)}</OutPoint><InPoint>${T(516)}</InPoint></Clip></VideoClip>
  <VideoClip ObjectID="43"><Clip><Source ObjectRef="53"/><OutPoint>${T(2)}</OutPoint><InPoint>${T(0)}</InPoint></Clip></VideoClip>
  <VideoMediaSource ObjectID="52"><MediaSource><Media ObjectURef="m2"/></MediaSource></VideoMediaSource>
  <VideoMediaSource ObjectID="53"><MediaSource><Media ObjectURef="m3"/></MediaSource></VideoMediaSource>
  <Media ObjectUID="m2"><ActualMediaFilePath>C:\\KC Holdings\\KC Entertainment\\Al22 2026\\LOUISVILLE.mp4</ActualMediaFilePath></Media>
  <Media ObjectUID="m3"><ActualMediaFilePath>C:\\KC Holdings\\KC Entertainment\\YouTube\\Misc\\circle.png</ActualMediaFilePath></Media>
</PremiereData>`;

describe("Premiere project reader", () => {
  const p = parsePrproj(xml);
  const seq = p.sequences.find((s) => s.name === "kromah 2026");
  test("finds the sequence by its project name, at its frame rate", () => {
    expect(seq).toBeTruthy();
    expect(seq.fps).toBeCloseTo(29.97, 2);
  });
  test("each play: its game file and in/out in seconds", () => {
    const first = seq.plays[0];
    expect(first.file).toBe("FSU O VS. CLEMSON D.mp4");
    expect(first.in).toBeCloseTo(100);
    expect(first.out).toBeCloseTo(108);
    expect(first.start).toBeCloseTo(0);
  });
  test("a nested sequence is flattened into its plays (and stills come along, to be filtered)", () => {
    const nested = seq.plays.filter((x) => x.nested);
    expect(nested.map((x) => x.file).sort()).toEqual(["LOUISVILLE.mp4", "circle.png"]);
    const lou = nested.find((x) => x.file === "LOUISVILLE.mp4");
    expect(lou.start).toBeCloseTo(8);
    expect(lou.in).toBeCloseTo(516);
    expect(lou.out).toBeCloseTo(526);
  });
  test("baseName handles Windows paths", () => {
    expect(baseName("C:\\a\\b\\X.mp4")).toBe("X.mp4");
  });
});

describe("film folder", () => {
  test("a path walks from the picked folder's name down", () => {
    expect(relativeParts("C:\\KC Holdings\\KC Entertainment\\All22 store\\X.mp4", "KC Entertainment")).toEqual(["All22 store", "X.mp4"]);
    expect(relativeParts("C:\\KC Holdings\\KC Entertainment\\All22 store\\X.mp4", "all22 store")).toEqual(["X.mp4"]);
    expect(relativeParts("C:\\Other\\X.mp4", "KC Entertainment")).toBeNull();
  });
});

describe("studio timeline", () => {
  const segKeys = ["intro", "background", "strengths", "weaknesses", "verdict", "community"];
  const times = { intro: 15, background: 30, strengths: 80, weaknesses: 55, verdict: 45, community: 15 };
  const marks = defaultMarks(segKeys, 240, times, 3, 2);
  test("default marks spread the recording in the segment proportions", () => {
    expect(marks.intro).toBe(0);
    expect(marks.background).toBeCloseTo(15, 0);
    expect(marks.community).toBeGreaterThan(marks.verdict);
    expect(marks.reveal1).toBeGreaterThan(marks.verdict);
    expect(marks.reveal3).toBeLessThan(marks.community);
  });
  test("the marks to tap, in order (reveals inside the verdict)", () => {
    expect(markOrder(segKeys, 2).map((m) => m.id)).toEqual(["background", "strengths", "weaknesses", "verdict", "reveal1", "reveal2", "community"]);
  });
  test("the segment at a time", () => {
    expect(segmentAt(segKeys, marks, 240, 5).key).toBe("intro");
    expect(segmentAt(segKeys, marks, 240, marks.strengths + 1).key).toBe("strengths");
    expect(segmentAt(segKeys, marks, 240, 239).key).toBe("community");
  });
  test("the frame: the segment's clip first, then its still; a reveal at its mark", () => {
    const entries = [
      { kind: "mov", seg: "strengths", step: 0, anim: "list" }, { kind: "png", seg: "strengths", step: 0 },
      { kind: "mov", seg: "verdict", step: 0, anim: "verdict" }, { kind: "mov", seg: "verdict", step: 1, anim: "reveal" },
    ];
    const ctx = { segKeys, marks, duration: 240, entries, animSec: (a) => ({ list: 1.6, verdict: 1.8, reveal: 1.5 }[a]) };
    expect(overlayViewAt(ctx, marks.strengths + 0.8)).toEqual({ seg: "strengths", step: 0, anim: "list", t: expect.any(Number) });
    expect(overlayViewAt(ctx, marks.strengths + 5)).toEqual({ seg: "strengths", step: 0 });
    expect(overlayViewAt(ctx, marks.reveal1 + 0.5)).toEqual({ seg: "verdict", step: 1, anim: "reveal", t: expect.any(Number) });
    expect(overlayViewAt(ctx, marks.reveal1 + 3)).toEqual({ seg: "verdict", step: 1 });
  });
  test("plays fill a segment back to back and loop; a graphic sits on the first pass only", () => {
    const plays = [{ path: "a.mp4", in: 10, out: 18 }, { path: "b.mp4", in: 50, out: 56 }];
    const short = { intro: 0, background: 20, strengths: 40, weaknesses: 60, verdict: 80, community: 100 };
    const assign = { intro: [{ play: 0, in: 10, out: 18, overlay: { kind: "scoutcard" } }, { play: 1, in: 50, out: 56, overlay: { kind: "result", preset: "SACK" } }] };
    const layout = filmLayout({ segKeys, marks: short, duration: 120, assign, plays });
    expect(layout.map((x) => [x.start, x.end, x.pass])).toEqual([[0, 8, 0], [8, 14, 0], [14, 20, 1]]);
    expect(filmAt(layout, 9).srcTime).toBeCloseTo(51);
    expect(filmAt(layout, 25)).toBeNull();
    expect(assetAt(layout, 1).kind).toBe("scoutcard");
    expect(assetAt(layout, 13).kind).toBe("result");
    expect(assetAt(layout, 15)).toBeNull();
    // No loop: the segment goes empty after its plays.
    expect(filmLayout({ segKeys, marks: short, duration: 120, assign, plays, loop: false })).toHaveLength(2);
  });
  test("auto-fill: two plays to the intro (the first with the Scouting Card), the rest split", () => {
    const plays = Array.from({ length: 10 }, (_, i) => ({ in: i * 10, out: i * 10 + 7 }));
    const a = autoAssign(segKeys, marks, 240, plays);
    expect(a.intro).toHaveLength(2);
    expect(a.intro[0].overlay.kind).toBe("scoutcard");
    expect(a.strengths.length + a.weaknesses.length).toBe(8);
    expect(a.strengths.length).toBeGreaterThan(a.weaknesses.length);
  });
  test("YouTube chapters from the marks", () => {
    const segs = segKeys.map((k) => ({ key: k, chapter: k }));
    expect(chaptersText(segs, { ...marks, background: 14.6 }).split("\n").slice(0, 2)).toEqual(["0:00 intro", "0:14 background"]);
  });
});
