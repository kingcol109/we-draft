import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";

export default function Navbar() {
  const { user, login } = useAuth();
  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > lastScrollY) {
        // scrolling down → hide
        setShow(false);
      } else {
        // scrolling up → show
        setShow(true);
      }
      setLastScrollY(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  const baseStyle = {
    margin: "0 0.5rem",
    padding: "0.5rem 1rem",
    color: "#0055a5",
    border: "2px solid #f6a21d",
    borderRadius: "6px",
    textDecoration: "none",
    fontWeight: "bold",
    backgroundColor: "#ffffff",
    transition: "all 0.2s ease-in-out",
    cursor: "pointer",
  };

  const hoverStyle = {
    color: "#ffffff",
    backgroundColor: "#0055a5",
  };

  const authStyle = {
    ...baseStyle,
    backgroundColor: "#f6a21d",
    color: "#0055a5",
    border: "2px solid #ffffff",
  };

  const authHoverStyle = {
    backgroundColor: "#ffffff",
    color: "#f6a21d",
    border: "2px solid #f6a21d",
  };

  return (
    <nav
      style={{
        position: "fixed",
        top: show ? "0" : "-100px", // slide up when hidden
        left: 0,
        right: 0,
        backgroundColor: "#0055a5",
        padding: "1rem",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "1rem",
        transition: "top 0.3s ease-in-out",
        zIndex: 1000,
      }}
    >
      {/* Standard links */}
      {[
        { path: "/", label: "Home" },
        { path: "/community", label: "Community Board" },
        { path: "/boards", label: "My Boards" },
      ].map((link, index) => (
        <Link
          key={index}
          to={link.path}
          style={baseStyle}
          onMouseEnter={(e) => Object.assign(e.target.style, hoverStyle)}
          onMouseLeave={(e) => Object.assign(e.target.style, baseStyle)}
        >
          {link.label}
        </Link>
      ))}

      {/* Profile link if signed in */}
      {user && (
        <Link
          to="/profile"
          style={baseStyle}
          onMouseEnter={(e) => Object.assign(e.target.style, hoverStyle)}
          onMouseLeave={(e) => Object.assign(e.target.style, baseStyle)}
        >
          Profile
        </Link>
      )}

      {/* Auth button */}
      {!user && (
        <button
          onClick={login}
          style={authStyle}
          onMouseEnter={(e) => Object.assign(e.target.style, authHoverStyle)}
          onMouseLeave={(e) => Object.assign(e.target.style, authStyle)}
        >
          Sign In
        </button>
      )}
    </nav>
  );
}
