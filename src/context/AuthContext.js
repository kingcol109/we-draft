import { createContext, useContext, useState, useEffect } from "react";
import { auth, provider, db } from "../firebase";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // ── Modal controls ──
  const openAuthModal = () => setAuthModalOpen(true);
  const closeAuthModal = () => setAuthModalOpen(false);

  // ── `login` now opens the modal — all existing login() calls work unchanged ──
  const login = openAuthModal;

  // ── Google sign-in (called from inside the modal) ──
  const loginWithGoogle = async () => {
    await signInWithPopup(auth, provider);
  };

  // ── Email/password sign-up — creates Firestore user doc with empty username ──
  const signUpWithEmail = async (email, password) => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", result.user.uid), {
      uid: result.user.uid,
      email: result.user.email,
      username: "",
      usernameLower: "",
      createdAt: new Date().toISOString(),
    }, { merge: true });
    return result;
  };

  // ── Email/password sign-in ──
  const signInWithEmail = async (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  // ── Password reset ──
  const resetPassword = async (email) => {
    return sendPasswordResetEmail(auth, email);
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
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setAuthReady(true); // fires after first resolution, signed in or not
    });
    return unsubscribe;
  }, []);

  // ── Save/update display name ──
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
    <AuthContext.Provider value={{
      user, profile, authReady, login, logout, saveProfile,
      authModalOpen, openAuthModal, closeAuthModal,
      loginWithGoogle, signInWithEmail, signUpWithEmail, resetPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}