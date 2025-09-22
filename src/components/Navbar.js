import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";

export default function Navbar() {
  const { user, login } = useAuth();
  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > lastScrollY) {
        setShow(false); // scrolling down → hide
      } else {
        setShow(true); // scrolling up → show
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
        top: show ? "0" : "-100px",
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
      {/* ✅ PC / Desktop Navbar (unchanged) */}
      <div className="hidden md:flex">
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
      </div>

      {/* ✅ Mobile Navbar (hamburger + vertical dropdown) */}
      <div className="md:hidden w-full flex justify-between items-center">
        <Link
          to="/"
          style={{
            color: "#fff",
            fontWeight: "bold",
            fontSize: "1.25rem",
            textDecoration: "none",
          }}
        >
          We-Draft
        </Link>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: "1.5rem",
            cursor: "pointer",
          }}
        >
          ☰
        </button>

        {menuOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              backgroundColor: "#ffffff",
              borderTop: "2px solid #f6a21d",
              boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              textAlign: "center",
            }}
          >
            {[
              { path: "/", label: "Home" },
              { path: "/community", label: "Community Board" },
              { path: "/boards", label: "My Boards" },
            ].map((link, index) => (
              <Link
                key={index}
                to={link.path}
                style={{ ...baseStyle, width: "100%" }}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}

            {user && (
              <Link
                to="/profile"
                style={{ ...baseStyle, width: "100%" }}
                onClick={() => setMenuOpen(false)}
              >
                Profile
              </Link>
            )}

            {!user && (
              <button
                onClick={() => {
                  login();
                  setMenuOpen(false);
                }}
                style={{ ...authStyle, width: "100%" }}
              >
                Sign In
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
