
"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase/client";

export default function ChatPage() {
  const [message, setMessage] = useState("");

  const features = [
    { icon: "💬", title: "Private Chats", desc: "Message friends privately" },
    { icon: "👥", title: "Groups", desc: "Chat with your communities" },
    { icon: "📢", title: "Channels", desc: "Share news and updates" },
    { icon: "📞", title: "Calls", desc: "Voice and video calls" },
    { icon: "📁", title: "File Sharing", desc: "Share photos and documents" },
    { icon: "⚙️", title: "Settings", desc: "Manage your account" }
  ];

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#071b16",
      color: "white",
      fontFamily: "Arial, sans-serif",
      padding: "20px"
    }}>
      <header style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #315044",
        paddingBottom: "18px"
      }}>
        <h1 style={{ color: "#35d69a", fontSize: "32px" }}>Imran</h1>
        <button onClick={logout} style={buttonStyle}>Logout</button>
      </header>

      <section style={{ marginTop: "35px" }}>
        <h2>Welcome to Imran 👋</h2>
        <p style={{ color: "#b8cfc5" }}>
          Connect. Chat. Share.
        </p>
      </section>

      <section style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
        gap: "15px",
        marginTop: "30px"
      }}>
        {features.map((feature) => (
          <article key={feature.title} style={cardStyle}>
            <div style={{ fontSize: "32px" }}>{feature.icon}</div>
            <h3>{feature.title}</h3>
            <p style={{ color: "#b8cfc5", fontSize: "13px" }}>
              {feature.desc}
            </p>
          </article>
        ))}
      </section>

      <section style={{
        marginTop: "35px",
        background: "#102a22",
        padding: "20px",
        borderRadius: "15px"
      }}>
        <h3>Start a conversation</h3>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Search people..."
          style={inputStyle}
        />
        <p style={{ color: "#b8cfc5", fontSize: "13px" }}>
          Your conversations will appear here.
        </p>
      </section>

      <footer style={{
        textAlign: "center",
        marginTop: "45px",
        color: "#8ba99b"
      }}>
        © 2026 Imran. Connect without limits.
      </footer>
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  background: "#20c98a",
  color: "#071b16",
  border: "none",
  borderRadius: "8px",
  padding: "11px 18px",
  fontWeight: "bold"
};

const cardStyle: React.CSSProperties = {
  background: "#102a22",
  border: "1px solid #315044",
  borderRadius: "15px",
  padding: "20px"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "14px",
  marginTop: "10px",
  borderRadius: "9px",
  border: "1px solid #426457",
  background: "#071b16",
  color: "white"
};
