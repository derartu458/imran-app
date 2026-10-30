
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase/client";

export default function Home() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setMessage("Login successful!");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage("Registration successful! Check your email to confirm your account.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#071b16",
      color: "white",
      padding: "20px",
      fontFamily: "Arial, sans-serif"
    }}>
      <section style={{
        width: "100%",
        maxWidth: "400px",
        background: "#102a22",
        padding: "30px",
        borderRadius: "20px",
        boxShadow: "0 10px 40px #0005"
      }}>
        <h1 style={{
          textAlign: "center",
          fontSize: "38px",
          color: "#35d69a",
          marginBottom: "8px"
        }}>Imran</h1>

        <p style={{ textAlign: "center", color: "#b8cfc5" }}>
          Connect. Chat. Share.
        </p>

        <h2 style={{ textAlign: "center", marginTop: "30px" }}>
          {isLogin ? "Welcome Back" : "Create Account"}
        </h2>

        <form onSubmit={handleSubmit}>
          <label>Email address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            style={inputStyle}
          />

          <label>Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            style={inputStyle}
          />

          <button
            type="submit"
            disabled={loading}
            style={buttonStyle}
          >
            {loading ? "Please wait..." : isLogin ? "Login" : "Register"}
          </button>
        </form>

        {message && (
          <p style={{ textAlign: "center", color: "#35d69a" }}>
            {message}
          </p>
        )}

        <p style={{ textAlign: "center", marginTop: "22px" }}>
          {isLogin ? "New to Imran?" : "Already have an account?"}
          {" "}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setMessage("");
            }}
            style={{
              background: "none",
              border: "none",
              color: "#35d69a",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            {isLogin ? "Create account" : "Login"}
          </button>
        </p>
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px",
  marginTop: "8px",
  marginBottom: "20px",
  borderRadius: "9px",
  border: "1px solid #426457",
  background: "#071b16",
  color: "white",
  boxSizing: "border-box"
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px",
  borderRadius: "9px",
  border: "none",
  background: "#20c98a",
  color: "#071b16",
  fontWeight: "bold",
  fontSize: "16px",
  cursor: "pointer"
};
