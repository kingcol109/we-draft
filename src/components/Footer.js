import React from "react";

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

      <p className="text-xs text-gray-500 italic">
        © {new Date().getFullYear()} We-Draft / King Cold Sports
      </p>
    </footer>
  );
}
