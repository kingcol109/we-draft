// src/pages/UserProfile.js
import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo from "../assets/Logo1.png"; // ✅ import logo
import verifiedBadge from "../assets/verified.png"; // ✅ import badge

export default function UserProfile() {
  const { user, logout } = useAuth();
  const [username, setUsername] = useState("");
  const [displayedUsername, setDisplayedUsername] = useState("");
  const [verified, setVerified] = useState(false); // ✅ new state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ✅ Make your own list of banned words here
  const bannedWords = [
    "fuck",
    "shit",
    "bitch",
    "tits",
    "cunt",
    "nigger",
    "nigga",
    "faggot",
    "fucc",
    "niga",
    "vagina",
    "penis",
    "asshole",
    "retard",
  ];

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const savedName = snap.data().username || "";
        setUsername(savedName);
        setDisplayedUsername(savedName);
        setVerified(snap.data().verified || false); // ✅ load verified
      }
      setLoading(false);
    };
    fetchProfile();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;

    const rawUsername = username.trim();
    const lowerUsername = rawUsername.toLowerCase();

    if (!lowerUsername) {
      setError("❌ Username cannot be empty.");
      return;
    }

    if (lowerUsername.length < 6) {
      setError("❌ Username must be at least 6 characters long.");
      return;
    }

    const containsBad = bannedWords.some((badWord) =>
      lowerUsername.includes(badWord.toLowerCase())
    );
    if (containsBad) {
      setError("❌ Username contains inappropriate language.");
      return;
    }

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("usernameLower", "==", lowerUsername));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const takenByAnother = querySnapshot.docs.some(
        (docSnap) => docSnap.id !== user.uid
      );
      if (takenByAnother) {
        setError("❌ Username already taken. Please choose another.");
        return;
      }
    }

    const ref = doc(db, "users", user.uid);
    await setDoc(
      ref,
      {
        uid: user.uid,
        email: user.email,
        username: rawUsername,
        usernameLower: lowerUsername,
      },
      { merge: true }
    );

    setDisplayedUsername(rawUsername);
    setError("");
    alert("✅ Profile updated!");
  };

  if (!user) {
    return <p className="text-center text-red-600">Please sign in first.</p>;
  }

  if (loading) return <p className="text-center">Loading...</p>;

  return (
    <div className="flex justify-center mt-10">
      <div className="bg-white border-4 border-[#f6a21d] rounded-lg p-8 w-full max-w-md shadow">
        {/* ✅ Logo at top */}
        <div className="flex justify-center mb-6">
          <img src={Logo} alt="Logo" className="h-20 object-contain" />
        </div>

        {/* ✅ Username with badge */}
        <h1 className="text-3xl font-extrabold text-[#0055a5] mb-6 text-center flex items-center justify-center">
          {displayedUsername || user.email}
          {verified && (
            <img
              src={verifiedBadge}
              alt="Verified"
              className="ml-2 w-6 h-6 inline-block"
            />
          )}
        </h1>

        <h2 className="text-xl font-bold text-[#0055a5] mb-4 text-center">
          Edit Profile
        </h2>

        <label className="block mb-2 font-semibold">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border-2 border-[#0055a5] rounded px-3 py-2 mb-2"
          placeholder="Enter username"
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          onClick={saveProfile}
          className="w-full bg-[#0055a5] text-white font-bold py-2 rounded border-2 border-[#f6a21d] hover:bg-[#003f7d] transition mb-4"
        >
          Save
        </button>

        <button
          onClick={logout}
          className="w-full bg-[#f6a21d] text-[#0055a5] font-bold py-2 rounded border-2 border-[#0055a5] hover:bg-[#fff5e0] transition"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
