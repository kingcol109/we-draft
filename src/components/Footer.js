import React from "react";
import { Link } from "react-router-dom";

// Rendered once, site-wide, from App.js's MainLayout — see that file's own
// comment on why (this component previously wasn't imported anywhere at
// all, so no page actually had a footer).
const LEGAL_LINKS = [
  { to: "/terms", label: "Terms of Service" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/guidelines", label: "Community Guidelines" },
  { to: "/cookies", label: "Cookie Policy" },
];

export default function Footer({ color1 = "#0055a5", color2 = "#f6a21d" }) {
  return (
    <footer className="mt-20 text-center p-6">
      <div className="flex justify-center gap-6 mb-6 flex-wrap">
        <a
          href="https://www.youtube.com/@kingcoldsports"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-sm font-semibold rounded-full border-2 transition hover:opacity-90"
          style={{
            backgroundColor: color1,
            borderColor: color2,
            color: "white",
          }}
        >
          YouTube
        </a>
        <a
          href="https://www.instagram.com/wedraftsite"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-sm font-semibold rounded-full border-2 transition hover:opacity-90"
          style={{
            backgroundColor: color1,
            borderColor: color2,
            color: "white",
          }}
        >
          Instagram
        </a>
        <a
          href="https://twitter.com/WeDraftSite"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 text-sm font-semibold rounded-full border-2 transition hover:opacity-90"
          style={{
            backgroundColor: color1,
            borderColor: color2,
            color: "white",
          }}
        >
          Twitter / X
        </a>
      </div>

      <div className="flex justify-center gap-4 mb-4 flex-wrap">
        {LEGAL_LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="text-xs font-semibold text-gray-500 hover:underline"
          >
            {l.label}
          </Link>
        ))}
      </div>

      <p className="text-xs text-gray-500 italic">
        © {new Date().getFullYear()} We-Draft / King Cold Sports
      </p>
    </footer>
  );
}
