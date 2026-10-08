import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext"; // ✅ import provider
import { initPageZoom } from "./utils/pageZoom";

initPageZoom();

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
