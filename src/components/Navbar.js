import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";
import Logo2 from "../assets/Logo2.png";

export default function Navbar() {
  const { user, login } = useAuth();
  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) return;

    const handleScroll = () => {
      setShow(window.scrollY < lastScrollY);
      setLastScrollY(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY, isMobile]);

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
        top: isMobile ? "0" : show ? "0" : "-100px",
        left: 0,
        right: 0,
        backgroundColor: "#0055a5",
        padding: "0.75rem 1.5rem",
        display: "flex",
        alignItems: "center",
        transition: isMobile ? "none" : "top 0.3s ease-in-out",
        zIndex: 1000,
      }}
    >
      {/* 🔷 Logo pinned left */}
      <Link to="/" style={{ display: "flex", alignItems: "center" }}>
        <img
          src={Logo2}
          alt="We-Draft Logo"
          style={{
            height: "42px",
            width: "auto",
            cursor: "pointer",
          }}
        />
      </Link>

      {/* ✅ Desktop Nav — truly centered */}
      <div
        className="hidden md:flex"
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          alignItems: "center",
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
            onClick={async () => {
              try {
                await login();
              } catch (err) {
                console.error(err);
              }
            }}
            style={authStyle}
            onMouseEnter={(e) => Object.assign(e.target.style, authHoverStyle)}
            onMouseLeave={(e) => Object.assign(e.target.style, authStyle)}
          >
            Sign In
          </button>
        )}
      </div>

      {/* ✅ Mobile Navbar */}
      <div className="md:hidden ml-auto">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: "1.75rem",
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

            {!user && (
              <button
                onClick={async () => {
                  await login();
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
