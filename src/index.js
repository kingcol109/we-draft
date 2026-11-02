import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext"; // ✅ import provider
import { initPageZoom } from "./utils/pageZoom";

initPageZoom();

// "ResizeObserver loop completed with undelivered notifications" is the
// browser noting a resize it deferred to the next frame — harmless, never
// shown to visitors, but the dev server's error overlay reports it as a crash.
window.addEventListener("error", (e) => {
  if (/ResizeObserver loop/.test(e.message || "")) e.stopImmediatePropagation();
}, true); // capture: runs ahead of the overlay's own listener

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
<link
  href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap"
  rel="stylesheet"
/>
