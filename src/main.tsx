import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";

if (window.location.protocol === "file:") {
  document.querySelector("#root").innerHTML =
    '<main class="auth-shell"><section class="auth-card"><h1>Inicia el servidor del CRM</h1><p>Ejecuta <code>npm install</code> y <code>npm run dev</code> en la carpeta que contiene <code>package.json</code>.</p><p>Después abre <a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a>.</p></section></main>';
} else {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
