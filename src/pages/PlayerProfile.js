// src/pages/PlayerProfile.js
import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import Logo1 from "../assets/Logo1.png";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import verifiedBadge from "../assets/verified.png";
import { Helmet } from "react-helmet-async";
import * as htmlToImage from "html-to-image";
import confetti from "canvas-confetti";

// ── Grade lock: 2026 prospects only, locked at 8PM ET April 23rd 2026 ────────
const GRADE_LOCK_DATE = new Date("2026-04-23T20:00:00-04:00");

function sanitizeImgur(url) {
  if (!url) return "";
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;
  const singleMatch = url.match(/^https?:\/\/imgur\.com\/(?!a\/|gallery\/)([A-Za-z0-9]+)$/i);
  if (singleMatch) return `https://i.imgur.com/${singleMatch[1]}.png`;
  if (/^https?:\/\/imgur\.com\/(a|gallery)\//i.test(url)) return "";
  return url;
}
function sanitizeGoogleDrive(url) {
  if (!url) return "";
  const m = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}
function sanitizeUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (u.includes("imgur.com")) u = sanitizeImgur(u);
  if (u.includes("drive.google.com")) u = sanitizeGoogleDrive(u);
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const toTeamSlug = (school) => {
  if (!school) return "";
  return school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
};

function teamNameFromAbbr(abbr) {
  const map = {
    ARI:"Arizona Cardinals",ATL:"Atlanta Falcons",BAL:"Baltimore Ravens",BUF:"Buffalo Bills",
    CAR:"Carolina Panthers",CHI:"Chicago Bears",CIN:"Cincinnati Bengals",CLE:"Cleveland Browns",
    DAL:"Dallas Cowboys",DEN:"Denver Broncos",DET:"Detroit Lions",GB:"Green Bay Packers",
    HOU:"Houston Texans",IND:"Indianapolis Colts",JAX:"Jacksonville Jaguars",KC:"Kansas City Chiefs",
    LV:"Las Vegas Raiders",LAC:"Los Angeles Chargers",LAR:"Los Angeles Rams",MIA:"Miami Dolphins",
    MIN:"Minnesota Vikings",NE:"New England Patriots",NO:"New Orleans Saints",NYG:"New York Giants",
    NYJ:"New York Jets",PHI:"Philadelphia Eagles",PIT:"Pittsburgh Steelers",SF:"San Francisco 49ers",
    SEA:"Seattle Seahawks",TB:"Tampa Bay Buccaneers",TEN:"Tennessee Titans",WAS:"Washington Commanders",
  };
  return map[abbr] || abbr;
}

const teamNameToAbbr = {
  "Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF",
  "Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE",
  "Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB",
  "Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC",
  "Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA",
  "Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG",
  "New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF",
  "Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS",
};

export default function PlayerProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState(null);
  const { user } = useAuth();
  const evaluationFormRef = useRef(null);
  const exportCardRef = useRef(null);
  const [draftedBy, setDraftedBy] = useState(null);
  const [draftInfo, setDraftInfo] = useState(null);
  const [playerNews, setPlayerNews] = useState([]);
  const [scoutName, setScoutName] = useState("");
  const [branding, setBranding] = useState(null);
  const cfbLogoRef = useRef("");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  const [grade, setGrade] = useState("");
  const [strengths, setStrengths] = useState([]);
  const [weaknesses, setWeaknesses] = useState([]);
  const [nflFit, setNflFit] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [traits, setTraits] = useState({});
  const [community, setCommunity] = useState({ avgGrade: null, topStrengths: [], topWeaknesses: [], topFits: [] });
  const [publicFeed, setPublicFeed] = useState([]);
  const [visibleCount, setVisibleCount] = useState(3);
  const [fitLogos, setFitLogos] = useState([]);
  const [nflFitLogo, setNflFitLogo] = useState("");
  const [feedLogoCache, setFeedLogoCache] = useState({});

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const gradeScale = {
    "Early First Round":1,"Middle First Round":2,"Late First Round":3,"Second Round":4,
    "Third Round":5,"Fourth Round":6,"Fifth Round":7,"Sixth Round":8,"Seventh Round":9,"UDFA":10,
  };
  const gradeLabels = {
    1:"Early First Round",2:"Middle First Round",3:"Late First Round",4:"Second Round",
    5:"Third Round",6:"Fourth Round",7:"Fifth Round",8:"Sixth Round",9:"Seventh Round",10:"UDFA",
  };
  const gradeDisplay = (g) => {
    const map = {
      "Watchlist":          { short:"W",   bg:"#5F5E5A", border:"#444441" },
      "Early First Round":  { short:"1st", bg:"#3B6D11", border:"#27500A" },
      "Middle First Round": { short:"1st", bg:"#3B6D11", border:"#27500A" },
      "Late First Round":   { short:"1st", bg:"#3B6D11", border:"#27500A" },
      "Second Round":       { short:"2nd", bg:"#0F6E56", border:"#085041" },
      "Third Round":        { short:"3rd", bg:"#185FA5", border:"#0C447C" },
      "Fourth Round":       { short:"4th", bg:"#BA7517", border:"#854F0B" },
      "Fifth Round":        { short:"5th", bg:"#BA7517", border:"#854F0B" },
      "Sixth Round":        { short:"6th", bg:"#993C1D", border:"#712B13" },
      "Seventh Round":      { short:"7th", bg:"#993C1D", border:"#712B13" },
      "UDFA":               { short:"U",   bg:"#A32D2D", border:"#791F1F" },
    };
    return map[g] || { short:g, bg:"#5F5E5A", border:"#444441" };
  };

  const bannedWords = ["faggot","nigger","monkey","nigga","fuck"];
  const containsProfanity = (text) => {
    if (!text) return false;
    return bannedWords.some((w) => text.toLowerCase().includes(w));
  };

  useEffect(() => {
    const fetch = async () => {
      try {
        const q = query(collection(db,"players"), where("Slug","==",slug));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = {...d.data()};
          const fortyKey = Object.keys(data).find((k) => k.replace(/\s/g,"") === "40Yard");
          if (fortyKey) data["40 Yard"] = data[fortyKey];
          setPlayer({ id:d.id, ...data });
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const fetch = async () => {
      try {
        const q = query(collection(db,"draftOrder"), where("Selection","==",slug));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0].data();
          setDraftedBy(d.Team);
          setDraftInfo({ round:d.Round, pick:d.Pick });
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [slug]);

  useEffect(() => {
    const fetch = async () => {
      if (!user?.uid) return;
      try {
        const snap = await getDoc(doc(db,"users",user.uid));
        setScoutName(snap.exists() ? (snap.data().username || user.email || "Anonymous Scout") : (user.email || "Anonymous Scout"));
      } catch(e) { setScoutName(user.email || "Anonymous Scout"); }
    };
    fetch();
  }, [user]);

  useEffect(() => {
    if (!slug) return;
    const fetch = async () => {
      try {
        const newsSnap = await getDocs(query(collection(db,"news"), where("active","==",true), where("slugs","array-contains",slug), orderBy("publishedAt","desc")));
        const newsItems = newsSnap.docs.map((d) => ({ id:d.id, type:"news", ...d.data() }));
        const articleSnap = await getDocs(query(collection(db,"articles"), where("status","==","published"), where("slugs","array-contains",slug), orderBy("updatedAt","desc")));
        const articleItems = articleSnap.docs.map((d) => ({ id:d.id, type:"article", ...d.data(), publishedAt:d.data().updatedAt }));
        const combined = [...newsItems, ...articleItems].sort((a,b) => (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0));
        setPlayerNews(combined);
      } catch(e) { setPlayerNews([]); }
    };
    fetch();
  }, [slug]);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.School) { setBranding(null); return; }
      try {
        const sSnap = await getDoc(doc(db,"schools",player.School));
        if (sSnap.exists()) {
          const b = sSnap.data();
          cfbLogoRef.current = b.Logo1 || b.Logo2 || "";
          setBranding({ color1:b.Color1||SITE_BLUE, color2:b.Color2||SITE_GOLD, logo1:b.Logo1||"", logo2:b.Logo2||"" });
        } else { setBranding(null); }
      } catch(e) { setBranding(null); }
    };
    fetch();
  }, [player]);

  useEffect(() => {
    if (!draftedBy) return;
    const fetch = async () => {
      try {
        const snap = await getDoc(doc(db,"nfl",draftedBy));
        if (snap.exists()) {
          const n = snap.data();
          setBranding({ color1:n.Color1, color2:n.Color2, nflLogo:n.Logo1, cfbLogo:cfbLogoRef.current });
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [draftedBy]);

  const color1 = draftedBy ? branding?.color1 : (branding?.color1 || SITE_BLUE);
  const color2 = draftedBy ? branding?.color2 : (branding?.color2 || SITE_GOLD);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.Position) return;
      try {
        const [posSnap, genSnap] = await Promise.all([getDoc(doc(db,"traits",player.Position)), getDoc(doc(db,"traits","Generic"))]);
        const g = {};
        if (posSnap.exists()) g["Position Specific"] = (posSnap.data().traits||[]).sort();
        if (genSnap.exists()) g["Generic"] = (genSnap.data().traits||[]).sort();
        setTraits(g);
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [player]);

  useEffect(() => {
    const fetch = async () => {
      if (!user || !player?.id) return;
      try {
        const snap = await getDoc(doc(db,"users",user.uid,"evaluations",player.id));
        if (snap.exists()) {
          const d = snap.data();
          setGrade(d.grade||""); setStrengths(d.strengths||[]); setWeaknesses(d.weaknesses||[]);
          setNflFit(d.nflFit||""); setEvaluation(d.evaluation||"");
          setVisibility(d.visibility||"public"); setLastUpdated(d.updatedAt||null);
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [user, player]);

  useEffect(() => {
    const fetch = async () => {
      if (!player?.id) return;
      try {
        const evalsSnap = await getDocs(collection(db,"players",player.id,"evaluations"));
        if (!evalsSnap.empty) {
          let grades=[], sC={}, wC={}, fC={}, pubEvals=[];
          const pubUids = new Set();
          evalsSnap.forEach((d) => {
            const data = d.data();
            if (data.grade && gradeScale[data.grade]) grades.push(gradeScale[data.grade]);
            if (Array.isArray(data.strengths)) data.strengths.forEach((s) => (sC[s]=(sC[s]||0)+1));
            if (Array.isArray(data.weaknesses)) data.weaknesses.forEach((w) => (wC[w]=(wC[w]||0)+1));
            if (data.nflFit) fC[data.nflFit]=(fC[data.nflFit]||0)+1;
            if (data.visibility==="public" && data.evaluation && data.evaluation.trim() !== "" && !containsProfanity(data.evaluation)) {
              pubEvals.push({ id:d.id, ...data });
              if (data.uid) pubUids.add(data.uid);
            }
          });
          const userDocs = await Promise.all(Array.from(pubUids).map((uid) => getDoc(doc(db,"users",uid))));
          const uMap = {};
          userDocs.forEach((snap) => { if (snap.exists()) { const u=snap.data(); uMap[snap.id]={name:u.username||u.email||snap.id, verified:u.verified||false}; } });
          const toMs = (ts) => ts?.toDate?.() ? ts.toDate().getTime() : typeof ts==="number" ? ts : Date.parse(ts)||0;
          const pubWithNames = pubEvals
            .map((ev) => ({ ...ev, username:uMap[ev.uid]?.name||ev.email||"User", verified:uMap[ev.uid]?.verified||false }))
            .sort((a,b) => { if (a.verified&&!b.verified) return -1; if (!a.verified&&b.verified) return 1; return toMs(b.updatedAt)-toMs(a.updatedAt); });
          setCommunity({
            avgGrade: grades.length>0 ? (grades.reduce((a,b)=>a+b,0)/grades.length).toFixed(1) : null,
            topStrengths: Object.entries(sC).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([s])=>s),
            topWeaknesses: Object.entries(wC).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([w])=>w),
            topFits: Object.entries(fC).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t])=>t),
          });
          setPublicFeed(pubWithNames);
        } else {
          setCommunity({ avgGrade:null, topStrengths:[], topWeaknesses:[], topFits:[] });
          setPublicFeed([]);
        }
      } catch(e) { console.error(e); }
    };
    fetch();
  }, [player]);

  useEffect(() => {
    if (!publicFeed.length) return;
    const missing = [...new Set(publicFeed.map((ev)=>ev.nflFit).filter(Boolean))].filter((t)=>!feedLogoCache[t]);
    if (!missing.length) return;
    const fetch = async () => {
      const entries = await Promise.all(missing.map(async (tn) => {
        const abbr = teamNameToAbbr[tn];
        if (!abbr) return [tn,null];
        try { const snap=await getDoc(doc(db,"nfl",abbr)); return [tn, snap.exists()?snap.data().Logo1||null:null]; }
        catch { return [tn,null]; }
      }));
      setFeedLogoCache((prev)=>({...prev,...Object.fromEntries(entries)}));
    };
    fetch();
  }, [publicFeed]);

  useEffect(() => {
    const fetch = async () => {
      if (!nflFit) { setNflFitLogo(""); return; }
      const abbr = teamNameToAbbr[nflFit];
      if (!abbr) { setNflFitLogo(""); return; }
      try { const snap=await getDoc(doc(db,"nfl",abbr)); setNflFitLogo(snap.exists()?snap.data().Logo1||"":""); }
      catch { setNflFitLogo(""); }
    };
    fetch();
  }, [nflFit]);

  useEffect(() => {
    const fetch = async () => {
      if (!community.topFits.length) { setFitLogos([]); return; }
      try {
        const logos = await Promise.all(community.topFits.map(async (tn) => {
          const abbr = teamNameToAbbr[tn];
          if (!abbr) return {teamName:tn, logo:null};
          const snap = await getDoc(doc(db,"nfl",abbr));
          return {teamName:tn, logo:snap.exists()?snap.data().Logo1:null};
        }));
        setFitLogos(logos);
      } catch(e) { setFitLogos([]); }
    };
    fetch();
  }, [community.topFits]);

  const handleExportImage = async () => {
    if (!exportCardRef.current) return;
    try {
      const dataUrl = await htmlToImage.toPng(exportCardRef.current, { pixelRatio:2, backgroundColor:"#ffffff", skipFonts:true, filter:(node)=>node.tagName!=="IMG" });
      const link = document.createElement("a");
      link.download = `${player.First}_${player.Last}_Evaluation.png`;
      link.href = dataUrl; link.click();
    } catch(e) { alert("Failed to export image. Please try again."); }
  };

  const handleSaveEvaluation = async () => {
    if (!user||!player?.id) return alert("You must sign in first.");
    if (visibility==="public"&&containsProfanity(evaluation)) return alert("❌ Your evaluation contains inappropriate language.");

    // If grade is locked, save everything EXCEPT grade — preserve the stored grade
    const gradeLocked = player?.Eligible === "2026" && new Date() >= GRADE_LOCK_DATE;

    setSaving(true);
    try {
      // Fetch existing grade if locked so we don't overwrite it
      let savedGrade = grade;
      if (gradeLocked) {
        const existing = await getDoc(doc(db,"users",user.uid,"evaluations",player.id));
        savedGrade = existing.exists() ? (existing.data().grade || grade) : grade;
      }

      const evalData = {
        uid:user.uid, email:user.email, playerId:player.id,
        playerName:`${player.First||""} ${player.Last||""}`.trim(),
        grade: savedGrade, strengths, weaknesses, nflFit, evaluation, visibility,
        updatedAt:serverTimestamp(),
      };
      await setDoc(doc(db,"players",player.id,"evaluations",user.uid), evalData);
      await setDoc(doc(db,"users",user.uid,"evaluations",player.id), evalData);
      confetti({ particleCount:140, spread:75, origin:{y:0.65}, colors:[color1,color2,"#ffffff"] });
      setLastUpdated(Date.now());
    } catch(e) { alert("❌ Failed to save evaluation. Try again."); }
    finally { setSaving(false); }
  };

  async function handleRemoveEvaluation() {
    if (!user||!player?.id) return alert("You must sign in first.");
    if (!window.confirm("Remove evaluation from your board?")) return;
    try {
      const { deleteDoc, doc:fDoc } = await import("firebase/firestore");
      await Promise.all([deleteDoc(fDoc(db,"players",player.id,"evaluations",user.uid)), deleteDoc(fDoc(db,"users",user.uid,"evaluations",player.id))]);
      setGrade(""); setStrengths([]); setWeaknesses([]); setNflFit(""); setEvaluation(""); setVisibility("public"); setLastUpdated(null);
      alert("🗑️ Evaluation removed from your board.");
    } catch(e) { alert("❌ Failed to remove evaluation. Try again."); }
  }

  const renderDate = (ts) => {
    if (!ts) return "";
    try { return ts?.toDate?.() ? ts.toDate().toLocaleString() : typeof ts==="number" ? new Date(ts).toLocaleString() : new Date(ts).toLocaleString(); }
    catch { return ""; }
  };

  if (!player) return <div className="flex justify-center items-center h-screen text-xl font-bold" style={{color:SITE_BLUE}}>Loading Player...</div>;

  // ── Grade lock check ────────────────────────────────────────────────────────
  const gradeIsLocked = player?.Eligible === "2026" && new Date() >= GRADE_LOCK_DATE;

  const physicalMeasurements = [
    {val:player.Height,label:"Height"},{val:player.Weight,label:"Weight"},
    {val:player.Wingspan,label:"Wing"},{val:player["Arm Length"],label:"Arm"},{val:player["Hand Size"],label:"Hand"},
  ].filter((m)=>m.val);

  const athleticMeasurements = [
    {val:player["40 Yard"],label:"40 Yd"},{val:player.Vertical,label:"Vert"},{val:player.Broad,label:"Broad"},
    {val:player["3-Cone"],label:"3-Cone"},{val:player.Shuttle,label:"Shutt"},{val:player.Bench,label:"Bench"},
  ].filter((m)=>m.val);

  const hasAthletic = athleticMeasurements.length > 0;

  const StatPill = ({ val, label }) => (
    <div style={{ display:"inline-flex", flexDirection:"column", alignItems:"center", background:"#fff", border:`2px solid ${color1}`, borderRadius:"8px", padding:isMobile?"5px 10px":"7px 16px", minWidth:isMobile?"52px":"68px" }}>
      <span style={{ fontSize:isMobile?"13px":"18px", fontWeight:900, color:color1, lineHeight:1.1 }}>{val}</span>
      <span style={{ fontSize:isMobile?"9px":"11px", fontWeight:800, color:"#888", letterSpacing:"0.08em", marginTop:"3px", textTransform:"uppercase" }}>{label}</span>
    </div>
  );

  const GroupLabel = ({ children }) => (
    <div style={{ fontSize:"10px", fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:"6px", textAlign:"center" }}>{children}</div>
  );

  const SectionTitle = ({ children }) => (
    <>
      <div className="font-black uppercase mb-2" style={{ color:color1, fontSize:isMobile?"17px":"22px", letterSpacing:"0.08em" }}>{children}</div>
      <div className="mb-4 rounded-sm" style={{ height:"3px", backgroundColor:color1 }} />
    </>
  );

  const GradeBadge = ({ g, large=false }) => {
    const { short, bg, border } = gradeDisplay(g);
    return (
      <div className="rounded text-center" style={{ backgroundColor:bg, border:`${large?4:3}px solid ${border}`, padding:large?"10px 16px":"8px 10px", minWidth:large?"100%":"auto" }}>
        <div style={{ fontSize:large?"52px":"36px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em" }}>{short}</div>
        <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.07em", marginTop:"3px" }}>{g}</div>
      </div>
    );
  };

  return (
    <>
      <Helmet>
        <title>{`${player.First||""} ${player.Last||""} Draft Scouting Report | We-Draft`}</title>
        <meta name="description" content={`Scouting report for ${player.First||""} ${player.Last||""}, ${player.Position||""} from ${player.School||""}.`} />
        <meta property="og:title" content={`${player.First||""} ${player.Last||""} Scouting Report`} />
        <meta property="og:url" content={`https://we-draft.com/player/${slug}`} />
        <link rel="canonical" href={`https://we-draft.com/player/${slug}`} />
      </Helmet>

      <div className="max-w-6xl mx-auto pb-40" style={{ padding:isMobile?"10px 10px 160px":"24px 24px 160px" }}>

        {/* ===== HERO CARD ===== */}
        <div className="mb-6 rounded-lg overflow-hidden" style={{ border:`3px solid ${color1}` }}>
          <div className="flex items-center justify-between" style={{ backgroundColor:color1, padding:isMobile?"8px 12px":"10px 20px" }}>
            <button onClick={()=>navigate(-1)} className="text-white font-extrabold rounded-full transition hover:opacity-80"
              style={{ border:"2px solid rgba(255,255,255,0.45)", background:"transparent", fontSize:isMobile?"12px":"15px", padding:isMobile?"4px 12px":"6px 20px" }}>
              ← Back
            </button>
            <div className="flex gap-2">
              {player.Link && (
                <button onClick={()=>{ const url=Array.isArray(player.Link)?player.Link[0]:player.Link; window.open(url,"_blank","noopener,noreferrer"); }}
                  className="text-white font-bold rounded-full transition hover:opacity-80"
                  style={{ border:"2px solid rgba(255,255,255,0.45)", background:"transparent", fontSize:isMobile?"12px":"15px", padding:isMobile?"4px 12px":"6px 20px" }}>
                  Film
                </button>
              )}
              {!draftedBy && (
                <button onClick={()=>evaluationFormRef.current?.scrollIntoView({behavior:"smooth",block:"start"})}
                  className="font-extrabold rounded-full transition hover:opacity-90"
                  style={{ backgroundColor:color2, border:`2px solid ${color2}`, color:"#fff", fontSize:isMobile?"12px":"15px", padding:isMobile?"4px 12px":"6px 20px" }}>
                  Evaluate
                </button>
              )}
            </div>
          </div>

          <div className="bg-white flex items-center" style={{ gap:isMobile?"8px":"16px", padding:isMobile?"12px 10px 8px":"20px 24px 10px" }}>
            <div className="flex-shrink-0 flex items-center justify-center" style={{ width:isMobile?60:112, height:isMobile?60:112, background:"#f8f8f8", border:"1px solid #eee", borderRadius:"8px" }}>
              {draftedBy ? (
                branding?.nflLogo ? <img src={sanitizeUrl(branding.nflLogo)} alt="NFL" style={{ height:isMobile?50:96, objectFit:"contain" }} /> : null
              ) : branding?.logo1 ? (
                <Link to={`/team/${toTeamSlug(player.School)}`} className="flex items-center justify-center w-full h-full">
                  <img src={sanitizeUrl(branding.logo1)} alt={player.School} style={{ height:isMobile?50:96, objectFit:"contain" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} loading="lazy" />
                </Link>
              ) : null}
            </div>

            <div className="flex-1 text-center">
              <h1 className="font-black uppercase leading-none" style={{ fontSize:isMobile?"clamp(20px,6vw,30px)":"clamp(36px,5vw,58px)", color:color1, letterSpacing:"0.02em" }}>
                {`${player.First||""} ${player.Last||""}`}
              </h1>
              <div className="flex items-center justify-center flex-wrap mt-2" style={{ gap:isMobile?"6px":"10px" }}>
                <span className="font-extrabold rounded-full" style={{ backgroundColor:color1, color:"#fff", letterSpacing:"0.05em", fontSize:isMobile?"11px":"17px", padding:isMobile?"2px 8px":"3px 16px" }}>
                  {player.Position}
                </span>
                <span style={{ color:"#ccc" }}>·</span>
                <span onClick={()=>navigate(`/team/${toTeamSlug(player.School)}`)} className="font-extrabold hover:underline cursor-pointer" style={{ color:color1, fontSize:isMobile?"12px":"19px" }}>
                  {player.School}
                </span>
                <span style={{ color:"#ccc" }}>·</span>
                <span className="font-bold" style={{ color:"#666", fontSize:isMobile?"12px":"19px" }}>{player.Eligible}</span>
              </div>
              {draftedBy && draftInfo && (
                <div className="flex items-center justify-center gap-3 mt-2">
                  <div className="flex flex-col items-center justify-center rounded text-center" style={{ backgroundColor:color1, border:`2px solid ${color2}`, padding:"4px 12px", minWidth:"68px" }}>
                    <div style={{ fontSize:"11px", fontWeight:900, color:"rgba(255,255,255,0.85)", textTransform:"uppercase", letterSpacing:"0.1em" }}>Round {draftInfo.round}</div>
                    <div style={{ fontSize:"9px", fontWeight:700, color:"rgba(255,255,255,0.65)", textTransform:"uppercase", marginTop:"1px" }}>Pick {draftInfo.pick}</div>
                  </div>
                  <div className="text-left">
                    <div style={{ fontSize:"10px", fontWeight:800, color:"#999", textTransform:"uppercase", letterSpacing:"0.1em" }}>Selected by</div>
                    <span onClick={()=>navigate(`/nfl/${draftedBy.toLowerCase()}`)} className="font-black uppercase cursor-pointer hover:underline" style={{ fontSize:isMobile?"13px":"18px", color:color1, letterSpacing:"0.04em" }}>
                      {teamNameFromAbbr(draftedBy)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-shrink-0 flex items-center justify-center" style={{ width:isMobile?60:112, height:isMobile?60:112, background:"#f8f8f8", border:"1px solid #eee", borderRadius:"8px" }}>
              {draftedBy ? (
                branding?.cfbLogo ? (
                  <Link to={`/team/${toTeamSlug(player.School)}`} className="flex items-center justify-center w-full h-full">
                    <img src={sanitizeUrl(branding.cfbLogo)} alt="College" style={{ height:isMobile?42:88, objectFit:"contain" }} />
                  </Link>
                ) : null
              ) : branding?.logo2 ? (
                <Link to={`/team/${toTeamSlug(player.School)}`} className="flex items-center justify-center w-full h-full">
                  <img src={sanitizeUrl(branding.logo2)} alt={`${player.School} Logo 2`} style={{ height:isMobile?50:96, objectFit:"contain" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} loading="lazy" />
                </Link>
              ) : null}
            </div>
          </div>

          {physicalMeasurements.length > 0 && (
            <div className="bg-white" style={{ padding:isMobile?"6px 10px 12px":"8px 24px 16px" }}>
              {isMobile ? (
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px", justifyContent:"center" }}>
                  <div style={{ width:"100%", fontSize:"9px", fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:"#aaa", textAlign:"center", marginBottom:"2px" }}>Physical</div>
                  {physicalMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                  {hasAthletic && <>
                    <div style={{ width:"100%", fontSize:"9px", fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:"#aaa", textAlign:"center", marginTop:"6px", marginBottom:"2px" }}>Athletic Testing</div>
                    {athleticMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                  </>}
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"center", gap:0 }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                    <GroupLabel>Physical</GroupLabel>
                    <div style={{ display:"flex", gap:"7px", flexWrap:"wrap", justifyContent:"center" }}>
                      {physicalMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                    </div>
                  </div>
                  {hasAthletic && <div style={{ width:"1px", background:"#e0e0e0", alignSelf:"stretch", margin:"18px 20px 0", flexShrink:0 }} />}
                  {hasAthletic && (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <GroupLabel>Athletic Testing</GroupLabel>
                      <div style={{ display:"flex", gap:"7px", flexWrap:"wrap", justifyContent:"center" }}>
                        {athleticMeasurements.map((m) => <StatPill key={m.label} val={m.val} label={m.label} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ height:"5px", backgroundColor:color2 }} />
        </div>

        {/* ===== Community Scouting Report ===== */}
        <div className="mb-8">
          <SectionTitle>Community Scouting Report</SectionTitle>
          {isMobile ? (
            <div className="bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
              <div className="flex items-start gap-4 px-3 py-3" style={{ borderBottom:"1px solid #e5e7eb" }}>
                <div style={{ flex:"0 0 100px" }}>
                  <div className="text-xs font-black uppercase pb-1 mb-2 text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Grade</div>
                  {community.avgGrade ? (() => {
                    const label = gradeLabels[Math.round(community.avgGrade)];
                    const { short, bg, border } = gradeDisplay(label);
                    return (
                      <div>
                        <div className="rounded text-center" style={{ backgroundColor:bg, border:`2px solid ${border}`, padding:"6px 10px" }}>
                          <div style={{ fontSize:"28px", fontWeight:900, color:"#fff", lineHeight:1 }}>{short}</div>
                          <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", marginTop:"2px" }}>{label}</div>
                        </div>
                        <div className="mt-2">
                          <div style={{ height:"5px", background:"#eee", borderRadius:"3px", position:"relative", overflow:"hidden" }}>
                            <div style={{ position:"absolute", left:`${((parseFloat(community.avgGrade)-1)/9)*92}%`, width:"8%", height:"100%", backgroundColor:bg, borderRadius:"3px" }} />
                          </div>
                          <div className="flex justify-between mt-1" style={{ fontSize:"8px", color:"#bbb", fontWeight:700 }}><span>1st</span><span>UDFA</span></div>
                        </div>
                      </div>
                    );
                  })() : <p className="italic text-gray-400 text-xs text-center">No grade</p>}
                </div>
                <div style={{ flex:1 }}>
                  <div className="text-xs font-black uppercase pb-1 mb-2 text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>NFL Fit</div>
                  {fitLogos.length > 0 ? (
                    <div className="flex justify-center gap-2">
                      {fitLogos.map(({ teamName, logo }) => logo ? <img key={teamName} src={sanitizeUrl(logo)} alt={teamName} title={teamName} style={{ width:"40px", height:"40px", objectFit:"contain" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} /> : null)}
                    </div>
                  ) : community.topFits.length > 0 ? (
                    <div className="flex flex-col items-center gap-1">
                      {community.topFits.map((t,i) => <p key={i} className="text-xs font-bold text-gray-600 text-center">{t}</p>)}
                    </div>
                  ) : <p className="italic text-gray-400 text-xs text-center">No fits</p>}
                </div>
              </div>
              <div className="flex">
                <div className="flex-1 px-3 py-3" style={{ borderRight:"1px solid #e5e7eb" }}>
                  <div className="text-xs font-black uppercase pb-1 mb-2" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Strengths</div>
                  {community.topStrengths.length > 0 ? community.topStrengths.map((s,i) => (
                    <div key={i} className="font-black uppercase py-1" style={{ fontSize:"10px", borderBottom:i<community.topStrengths.length-1?"1px solid #f0f0f0":"none", color:"#222", letterSpacing:"0.04em" }}>{s}</div>
                  )) : <p className="italic text-gray-400 text-xs">None yet</p>}
                </div>
                <div className="flex-1 px-3 py-3">
                  <div className="text-xs font-black uppercase pb-1 mb-2" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Weaknesses</div>
                  {community.topWeaknesses.length > 0 ? community.topWeaknesses.map((w,i) => (
                    <div key={i} className="font-black uppercase py-1" style={{ fontSize:"10px", borderBottom:i<community.topWeaknesses.length-1?"1px solid #f0f0f0":"none", color:"#222", letterSpacing:"0.04em" }}>{w}</div>
                  )) : <p className="italic text-gray-400 text-xs">None yet</p>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
              <div className="flex flex-col items-center justify-center text-center px-6 py-5" style={{ flex:"0 0 210px", borderRight:"1px solid #e5e7eb" }}>
                <div className="text-sm font-black uppercase pb-2 mb-4 w-full text-center" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Grade</div>
                {community.avgGrade ? (() => {
                  const label = gradeLabels[Math.round(community.avgGrade)];
                  const { short, bg, border } = gradeDisplay(label);
                  return (
                    <>
                      <div className="rounded text-center" style={{ backgroundColor:bg, border:`3px solid ${border}`, padding:"10px 14px", width:"110px" }}>
                        <div style={{ fontSize:"36px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em" }}>{short}</div>
                        <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.07em", marginTop:"3px" }}>{label}</div>
                      </div>
                      <div className="mt-4 w-full">
                        <div className="flex justify-between mb-1" style={{ fontSize:"9px", fontWeight:800, color:"#bbb", letterSpacing:"0.06em", textTransform:"uppercase" }}>
                          <span>1st Rd</span><span>UDFA</span>
                        </div>
                        <div style={{ height:"8px", background:"#eee", borderRadius:"4px", position:"relative", overflow:"hidden" }}>
                          <div style={{ position:"absolute", left:`${((parseFloat(community.avgGrade)-1)/9)*92}%`, width:"8%", height:"100%", backgroundColor:bg, borderRadius:"4px" }} />
                        </div>
                      </div>
                    </>
                  );
                })() : <p className="italic text-gray-400 text-sm">No grade yet</p>}
              </div>
              <div className="flex-1 px-5 py-5" style={{ borderRight:"1px solid #e5e7eb" }}>
                <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Strengths</div>
                {community.topStrengths.length > 0 ? community.topStrengths.map((s,i) => (
                  <div key={i} className="py-2 font-black uppercase text-sm" style={{ borderBottom:i<community.topStrengths.length-1?"1px solid #f0f0f0":"none", color:"#222", letterSpacing:"0.06em" }}>{s}</div>
                )) : <p className="italic text-gray-400 text-sm">No strengths yet</p>}
              </div>
              <div className="flex-1 px-5 py-5" style={{ borderRight:"1px solid #e5e7eb" }}>
                <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Weaknesses</div>
                {community.topWeaknesses.length > 0 ? community.topWeaknesses.map((w,i) => (
                  <div key={i} className="py-2 font-black uppercase text-sm" style={{ borderBottom:i<community.topWeaknesses.length-1?"1px solid #f0f0f0":"none", color:"#222", letterSpacing:"0.06em" }}>{w}</div>
                )) : <p className="italic text-gray-400 text-sm">No weaknesses yet</p>}
              </div>
              <div className="flex flex-col px-5 py-5" style={{ flex:"0 0 150px" }}>
                <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>NFL Fit</div>
                {fitLogos.length > 0 ? (
                  <div className="flex flex-col items-center justify-around flex-1 gap-2">
                    {fitLogos.map(({ teamName, logo }) => logo ? <img key={teamName} src={sanitizeUrl(logo)} alt={teamName} title={teamName} className="object-contain" style={{ width:"52px", height:"52px" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} /> : null)}
                  </div>
                ) : community.topFits.length > 0 ? (
                  <div className="flex flex-col gap-1">{community.topFits.map((t,i) => <p key={i} className="text-sm font-bold text-gray-600">{t}</p>)}</div>
                ) : <p className="italic text-gray-400 text-sm">No fits yet</p>}
              </div>
            </div>
          )}
        </div>

        {/* ===== In the News ===== */}
        {playerNews.length > 0 && (
          <div className="mb-8">
            <SectionTitle>In the News</SectionTitle>
            <div className="bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
              {playerNews.map((n,i) => (
                <div key={n.slug||n.id} className="flex items-center hover:bg-gray-50 transition" style={{ gap:isMobile?"10px":"16px", padding:isMobile?"10px 12px":"14px 20px", borderBottom:i<playerNews.length-1?"1px solid #f0f0f0":"none" }}>
                  <div className="flex-shrink-0 flex flex-col items-center justify-center rounded text-white font-black" style={{ backgroundColor:color1, border:`2px solid ${color2}`, width:isMobile?38:48, height:isMobile?38:48, lineHeight:1 }}>
                    <span style={{ fontSize:isMobile?"12px":"16px", fontWeight:900 }}>{n.publishedAt?.toDate?.().toLocaleDateString(undefined,{day:"numeric"})}</span>
                    <span style={{ fontSize:"8px", fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase", opacity:0.85 }}>{n.publishedAt?.toDate?.().toLocaleDateString(undefined,{month:"short"})}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black uppercase rounded flex-shrink-0" style={{ backgroundColor:n.type==="article"?color2:color1, color:"#fff", letterSpacing:"0.08em", fontSize:"8px", padding:"2px 6px" }}>
                        {n.type==="article"?"Article":"News"}
                      </span>
                    </div>
                    <Link to={`/news/${n.slug}`} className="font-black uppercase hover:underline leading-tight block" style={{ color:"#222", letterSpacing:"0.04em", fontSize:isMobile?"11px":"13px" }}>
                      {n.title}
                    </Link>
                  </div>
                  <div className="flex-shrink-0 font-black" style={{ color:color1, fontSize:isMobile?"14px":"18px" }}>→</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== Hidden Export Card ===== */}
        <div style={{ position:"absolute", left:"-9999px", top:0 }}>
          <div ref={exportCardRef} style={{ width:"700px", backgroundColor:"#ffffff", border:`6px solid ${color1}`, fontFamily:"'Arial Black', Arial, sans-serif", overflow:"hidden" }}>
            <div style={{ backgroundColor:color1, padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ color:color2, fontSize:"30px", fontWeight:900, letterSpacing:"0.1em", textTransform:"uppercase" }}>WE-DRAFT.COM</div>
            </div>
            <div style={{ height:"5px", backgroundColor:color2 }} />
            <div style={{ padding:"24px 28px 16px", textAlign:"center" }}>
              <div style={{ fontSize:"56px", fontWeight:900, color:color1, lineHeight:1, letterSpacing:"0.02em", textTransform:"uppercase" }}>{player.First} {player.Last}</div>
              <div style={{ fontSize:"13px", fontWeight:700, color:"#999", letterSpacing:"0.08em", textTransform:"uppercase", marginTop:"8px" }}>Scouted by {scoutName}</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"12px", marginTop:"12px" }}>
                <span style={{ backgroundColor:color1, color:"#fff", fontWeight:900, fontSize:"16px", padding:"4px 18px", borderRadius:"20px", letterSpacing:"0.05em" }}>{player.Position}</span>
                <span style={{ color:"#ccc", fontSize:"20px" }}>·</span>
                <span style={{ color:color1, fontWeight:900, fontSize:"20px" }}>{player.School}</span>
                <span style={{ color:"#ccc", fontSize:"20px" }}>·</span>
                <span style={{ color:"#666", fontWeight:800, fontSize:"20px" }}>{player.Eligible}</span>
              </div>
            </div>
            <div style={{ height:"2px", backgroundColor:color2, margin:"0 28px" }} />
            <div style={{ display:"flex", padding:"20px 28px" }}>
              <div style={{ flex:"0 0 160px", paddingRight:"24px", borderRight:"2px solid #eee", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"14px", width:"100%", textAlign:"center" }}>Grade</div>
                {grade ? <GradeBadge g={grade} large={true} /> : <div style={{ color:"#aaa", fontSize:"13px", fontStyle:"italic" }}>No grade</div>}
              </div>
              <div style={{ flex:1, paddingLeft:"20px", paddingRight:"20px", borderRight:"2px solid #eee" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"12px" }}>Strengths</div>
                {strengths.length > 0 ? strengths.map((s,i) => <div key={i} style={{ fontSize:"12px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.06em", padding:"4px 0", borderBottom:i<strengths.length-1?"1px solid #f0f0f0":"none" }}>{s}</div>) : <div style={{ color:"#aaa", fontSize:"12px", fontStyle:"italic" }}>—</div>}
              </div>
              <div style={{ flex:1, paddingLeft:"20px", paddingRight:"20px", borderRight:"2px solid #eee" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"12px" }}>Weaknesses</div>
                {weaknesses.length > 0 ? weaknesses.map((w,i) => <div key={i} style={{ fontSize:"12px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.06em", padding:"4px 0", borderBottom:i<weaknesses.length-1?"1px solid #f0f0f0":"none" }}>{w}</div>) : <div style={{ color:"#aaa", fontSize:"12px", fontStyle:"italic" }}>—</div>}
              </div>
              <div style={{ flex:"0 0 110px", paddingLeft:"20px", display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"12px", width:"100%", textAlign:"center" }}>NFL Fit</div>
                {nflFit ? <div style={{ fontSize:"12px", fontWeight:900, color:color1, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.04em", lineHeight:1.3 }}>{nflFit}</div> : <div style={{ color:"#aaa", fontSize:"12px", fontStyle:"italic" }}>—</div>}
              </div>
            </div>
            {evaluation && (
              <>
                <div style={{ height:"2px", backgroundColor:color2, margin:"0 28px" }} />
                <div style={{ padding:"16px 28px" }}>
                  <div style={{ fontSize:"10px", fontWeight:900, color:color1, letterSpacing:"0.14em", textTransform:"uppercase", borderBottom:`3px solid ${color1}`, paddingBottom:"5px", marginBottom:"10px" }}>Scout's Take</div>
                  <p style={{ fontStyle:"italic", color:"#333", fontSize:"13px", lineHeight:1.6, margin:0 }}>"{evaluation}"</p>
                </div>
              </>
            )}
            <div style={{ height:"5px", backgroundColor:color2 }} />
            <div style={{ backgroundColor:color1, padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ color:color2, fontSize:"30px", fontWeight:900, letterSpacing:"0.1em", textTransform:"uppercase" }}>WE-DRAFT.COM</div>
            </div>
          </div>
        </div>

        {/* ===== Evaluation Form ===== */}
        <div ref={evaluationFormRef} className="mb-8">
          <SectionTitle>My Evaluation</SectionTitle>
          <div className="bg-white rounded-lg overflow-hidden" style={{ border:`2px solid ${color1}` }}>
            <div className="flex items-center justify-between" style={{ backgroundColor:color1, padding:isMobile?"8px 12px":"10px 20px" }}>
              <div className="font-black uppercase text-white tracking-wide" style={{ fontSize:isMobile?"13px":"18px" }}>
                {`${player.First||""} ${player.Last||""}`.toUpperCase()}
              </div>
              <img src={Logo1} alt="We-Draft Logo" className="w-auto object-contain opacity-90" style={{ height:isMobile?"20px":"28px", filter:"brightness(0) invert(1)" }} />
            </div>

            {!user ? (
              <div className="p-6 text-center">
                <p className="font-black uppercase" style={{ color:color1, fontSize:isMobile?"13px":"18px" }}>Sign in to submit an evaluation</p>
              </div>
            ) : (
              <div style={{ padding:isMobile?"12px":"24px" }}>

                {/* Grade lock notice */}
                {gradeIsLocked && (
                  <div style={{
                    display:"flex", alignItems:"center", gap:"10px",
                    background:"#fff8e1", border:`2px solid ${SITE_GOLD}`,
                    borderRadius:"8px", padding:"10px 14px", marginBottom:"16px",
                  }}>
                    <span style={{ fontSize:"18px" }}>🔒</span>
                    <div>
                      <div style={{ fontWeight:900, fontSize:"13px", color:"#7a5c00", textTransform:"uppercase", letterSpacing:"0.06em" }}>Grade Locked</div>
                      <div style={{ fontWeight:700, fontSize:"12px", color:"#9a7a00", marginTop:"2px" }}>
                        2026 draft grades were locked at 8PM ET on April 23rd. You can still edit your scouting notes, strengths, weaknesses, and NFL fit.
                      </div>
                    </div>
                  </div>
                )}

                <div className={isMobile?"flex flex-col gap-4 mb-4":"grid grid-cols-2 gap-6 mb-6"}>
                  <div>
                    <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>
                      Grade {gradeIsLocked && <span style={{ fontSize:"11px", color:"#aaa", fontWeight:700, textTransform:"none", letterSpacing:0 }}>— locked</span>}
                    </div>
                    {gradeIsLocked ? (
                      // Show the locked grade as a static display, not an editable select
                      <div style={{
                        width:"100%", borderRadius:"6px", padding:"10px 12px",
                        border:`2px solid #ddd`, background:"#f9f9f9",
                        fontWeight:700, fontSize:"14px", color:"#888",
                        display:"flex", alignItems:"center", gap:"8px",
                      }}>
                        <span>🔒</span>
                        <span>{grade || "No grade set"}</span>
                      </div>
                    ) : (
                      <select value={grade} onChange={(e)=>setGrade(e.target.value)} className="w-full rounded px-3 py-2 border-2 font-bold" style={{ borderColor:color1, color:grade?"#111":"#999" }}>
                        <option value="">Select a grade</option>
                        {["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"].map((g)=><option key={g} value={g}>{g}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Visibility</div>
                    <select value={visibility} onChange={(e)=>setVisibility(e.target.value)} className="w-full rounded px-3 py-2 border-2 font-bold" style={{ borderColor:color1 }}>
                      <option value="public">🌍 Public</option>
                      <option value="private">🔒 Private</option>
                    </select>
                  </div>
                </div>

                <div className={isMobile?"flex flex-col gap-4 mb-4":"grid grid-cols-2 gap-6 mb-6"}>
                  {[
                    { label:"Strengths (max 5)", state:strengths, setState:setStrengths, other:weaknesses },
                    { label:"Weaknesses (max 5)", state:weaknesses, setState:setWeaknesses, other:strengths },
                  ].map(({ label, state, setState, other }) => (
                    <div key={label}>
                      <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>{label}</div>
                      <details className="w-full rounded border-2" style={{ borderColor:color1 }}>
                        <summary className="cursor-pointer px-3 py-2 bg-white font-bold text-sm" style={{ color:state.length>0?"#111":"#999" }}>
                          {state.length>0 ? state.join(", ") : `Select ${label.split(" ")[0].toLowerCase()}`}
                        </summary>
                        <div className="max-h-40 overflow-y-auto px-3 py-2 bg-white">
                          {Object.entries(traits).map(([lbl, options]) => (
                            <div key={lbl} className="mb-2">
                              <p className="font-black text-xs uppercase tracking-wider mb-1" style={{ color:color1 }}>{lbl}</p>
                              {options.map((trait) => (
                                <label key={trait} className="block text-sm py-1 cursor-pointer">
                                  <input type="checkbox" checked={state.includes(trait)} disabled={(!state.includes(trait)&&state.length>=5)||other.includes(trait)}
                                    onChange={()=>setState(state.includes(trait)?state.filter((x)=>x!==trait):[...state,trait])} className="mr-2" />
                                  {trait}
                                </label>
                              ))}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>

                <div className="mb-4">
                  <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>NFL Fit</div>
                  <select value={nflFit} onChange={(e)=>setNflFit(e.target.value)} className="w-full rounded px-3 py-2 border-2 font-bold" style={{ borderColor:color1, color:nflFit?"#111":"#999" }}>
                    <option value="">Select an NFL team</option>
                    {["Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers","Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs","Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins","Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants","New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers","Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders"].map((team)=><option key={team} value={team}>{team}</option>)}
                  </select>
                </div>

                <div className="mb-4">
                  <div className="text-sm font-black uppercase pb-2 mb-3" style={{ color:color1, borderBottom:`3px solid ${color1}`, letterSpacing:"0.14em" }}>Evaluation</div>
                  <textarea value={evaluation} onChange={(e)=>setEvaluation(e.target.value)} placeholder="Write your evaluation..." className="w-full rounded px-3 py-2 h-32 border-2 font-medium" style={{ borderColor:color1 }} />
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={handleSaveEvaluation} disabled={saving} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90" style={{ backgroundColor:color1, border:`2px solid ${color2}`, color:"#fff", letterSpacing:"0.08em" }}>
                    {saving?"Saving...":"Save Evaluation"}
                  </button>
                  <button onClick={handleExportImage} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90" style={{ backgroundColor:"#fff", border:`2px solid ${color1}`, color:color1, letterSpacing:"0.08em" }}>
                    Export as Image
                  </button>
                  {lastUpdated && <button onClick={handleRemoveEvaluation} className="w-full text-xs text-gray-400 hover:text-red-500 font-medium underline transition pt-1">Remove from Board</button>}
                  {lastUpdated && <p className="text-xs text-gray-400 text-center">{renderDate(lastUpdated)}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Public Feed ===== */}
        <div className="mb-10">
          <SectionTitle>Public Evaluations</SectionTitle>
          {publicFeed.length > 0 ? (
            <>
              {publicFeed.slice(0, visibleCount).map((ev) => (
                <div key={ev.uid} className="bg-white rounded-lg overflow-hidden mb-4" style={{ border:`2px solid ${color1}` }}>
                  <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor:color1 }}>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white uppercase tracking-wide" style={{ fontSize:isMobile?"11px":"14px" }}>{ev.username}</span>
                      {ev.verified && <img src={verifiedBadge} alt="Verified" className="w-4 h-4 inline-block" />}
                    </div>
                    {ev.updatedAt && <span style={{ color:"rgba(255,255,255,0.6)", fontSize:"10px", fontWeight:700 }}>{renderDate(ev.updatedAt)}</span>}
                  </div>
                  {isMobile ? (
                    <div>
                      {ev.grade && (() => { const { short, bg, border } = gradeDisplay(ev.grade); return (
                        <div className="flex items-center gap-3 px-3 py-3" style={{ borderBottom:"1px solid #e5e7eb" }}>
                          <div className="rounded text-center flex-shrink-0" style={{ backgroundColor:bg, border:`2px solid ${border}`, padding:"6px 10px", minWidth:"60px" }}>
                            <div style={{ fontSize:"24px", fontWeight:900, color:"#fff", lineHeight:1 }}>{short}</div>
                            <div style={{ fontSize:"7px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", marginTop:"2px" }}>{ev.grade}</div>
                          </div>
                          {ev.nflFit && (
                            <div className="flex flex-col items-center">
                              <div style={{ fontSize:"8px", fontWeight:800, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:"3px" }}>NFL Fit</div>
                              {feedLogoCache[ev.nflFit] ? <img src={sanitizeUrl(feedLogoCache[ev.nflFit])} alt={ev.nflFit} title={ev.nflFit} style={{ width:"36px", height:"36px", objectFit:"contain" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} />
                                : <div style={{ fontSize:"10px", fontWeight:800, color:color1, textAlign:"center" }}>{ev.nflFit}</div>}
                            </div>
                          )}
                        </div>
                      ); })()}
                      {(ev.strengths?.length > 0 || ev.weaknesses?.length > 0) && (
                        <div className="flex" style={{ borderBottom:ev.evaluation?"1px solid #e5e7eb":"none" }}>
                          {ev.strengths?.length > 0 && <div className="flex-1 px-3 py-2" style={{ borderRight:ev.weaknesses?.length>0?"1px solid #e5e7eb":"none" }}>
                            <div style={{ fontSize:"8px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`1px solid ${color1}`, paddingBottom:"3px", marginBottom:"4px" }}>Strengths</div>
                            {ev.strengths.map((s,i) => <div key={i} style={{ fontSize:"10px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.04em", padding:"2px 0" }}>{s}</div>)}
                          </div>}
                          {ev.weaknesses?.length > 0 && <div className="flex-1 px-3 py-2">
                            <div style={{ fontSize:"8px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`1px solid ${color1}`, paddingBottom:"3px", marginBottom:"4px" }}>Weaknesses</div>
                            {ev.weaknesses.map((w,i) => <div key={i} style={{ fontSize:"10px", fontWeight:900, textTransform:"uppercase", color:"#222", letterSpacing:"0.04em", padding:"2px 0" }}>{w}</div>)}
                          </div>}
                        </div>
                      )}
                      {ev.evaluation && <div className="px-3 py-3">
                        <div style={{ fontSize:"8px", fontWeight:900, color:color1, textTransform:"uppercase", letterSpacing:"0.1em", borderBottom:`1px solid ${color1}`, paddingBottom:"3px", marginBottom:"6px" }}>Scout's Take</div>
                        <p className="italic text-gray-700" style={{ fontSize:"12px" }}>"{ev.evaluation}"</p>
                      </div>}
                    </div>
                  ) : (
                    <div>
                      <div className="flex gap-0">
                        {ev.grade && (() => { const { short, bg, border } = gradeDisplay(ev.grade); return (
                          <div className="flex flex-col items-center justify-center text-center px-4 py-4" style={{ flex:"0 0 130px", borderRight:"1px solid #e5e7eb" }}>
                            <div className="text-xs font-black uppercase pb-1 mb-3 w-full text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Grade</div>
                            <div className="rounded w-full text-center" style={{ backgroundColor:bg, border:`3px solid ${border}`, padding:"8px 10px" }}>
                              <div style={{ fontSize:"36px", fontWeight:900, color:"#fff", lineHeight:1, letterSpacing:"-0.02em" }}>{short}</div>
                              <div style={{ fontSize:"8px", fontWeight:800, color:"rgba(255,255,255,0.8)", textTransform:"uppercase", letterSpacing:"0.07em", marginTop:"3px" }}>{ev.grade}</div>
                            </div>
                          </div>
                        ); })()}
                        {ev.strengths?.length > 0 && <div className="flex-1 px-4 py-4" style={{ borderRight:"1px solid #e5e7eb" }}>
                          <div className="text-xs font-black uppercase pb-1 mb-3" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Strengths</div>
                          {ev.strengths.map((s,i) => <div key={i} className="text-xs font-black uppercase py-1" style={{ color:"#222", letterSpacing:"0.06em", borderBottom:i<ev.strengths.length-1?"1px solid #f0f0f0":"none" }}>{s}</div>)}
                        </div>}
                        {ev.weaknesses?.length > 0 && <div className="flex-1 px-4 py-4" style={{ borderRight:ev.nflFit||ev.evaluation?"1px solid #e5e7eb":"none" }}>
                          <div className="text-xs font-black uppercase pb-1 mb-3" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Weaknesses</div>
                          {ev.weaknesses.map((w,i) => <div key={i} className="text-xs font-black uppercase py-1" style={{ color:"#222", letterSpacing:"0.06em", borderBottom:i<ev.weaknesses.length-1?"1px solid #f0f0f0":"none" }}>{w}</div>)}
                        </div>}
                        {ev.nflFit && <div className="flex flex-col items-center justify-center px-4 py-4" style={{ flex:"0 0 120px", borderRight:ev.evaluation?"1px solid #e5e7eb":"none" }}>
                          <div className="text-xs font-black uppercase pb-1 mb-3 w-full text-center" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>NFL Fit</div>
                          {feedLogoCache[ev.nflFit] ? <img src={sanitizeUrl(feedLogoCache[ev.nflFit])} alt={ev.nflFit} title={ev.nflFit} className="object-contain" style={{ width:"52px", height:"52px" }} referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}} />
                            : <div className="text-xs font-black uppercase text-center" style={{ color:color1, letterSpacing:"0.04em", lineHeight:1.4 }}>{ev.nflFit}</div>}
                        </div>}
                      </div>
                      {ev.evaluation && <>
                        <div style={{ height:"1px", backgroundColor:"#e5e7eb", margin:"0 16px" }} />
                        <div className="px-4 py-3">
                          <div className="text-xs font-black uppercase pb-1 mb-2" style={{ color:color1, borderBottom:`2px solid ${color1}`, letterSpacing:"0.12em" }}>Scout's Take</div>
                          <p className="italic text-sm text-gray-700">"{ev.evaluation}"</p>
                        </div>
                      </>}
                    </div>
                  )}
                </div>
              ))}
              {visibleCount < publicFeed.length && (
                <button onClick={()=>setVisibleCount((prev)=>prev+3)} className="w-full font-black uppercase py-3 rounded transition hover:opacity-90" style={{ backgroundColor:color1, border:`2px solid ${color2}`, color:"#fff", letterSpacing:"0.08em" }}>
                  Show More
                </button>
              )}
            </>
          ) : (
            <p className="italic text-gray-400 text-sm">No public evaluations yet.</p>
          )}
        </div>

      </div>
    </>
  );
}