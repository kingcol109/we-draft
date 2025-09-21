import { createContext, useContext, useState, useEffect } from "react";
import { auth, provider, db } from "../firebase"; 
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const login = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);

        // 🔹 load user profile
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          // no profile yet
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
    });
    return unsubscribe;
  }, []);

  // 🔹 save profile (for when user picks username)
  const saveProfile = async (username) => {
    if (!user) return;
    const ref = doc(db, "users", user.uid);
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      username,
      createdAt: new Date().toISOString(),
    });
    setProfile({ uid: user.uid, email: user.email, username });
  };

  return (
    <AuthContext.Provider value={{ user, profile, login, logout, saveProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
