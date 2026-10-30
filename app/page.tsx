export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b141a",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>💬</div>

        <h1 style={{ fontSize: "42px", margin: 0 }}>Imran</h1>

        <p style={{ color: "#aebac1", fontSize: "18px" }}>
          Connect. Chat. Share.
        </p>

        <button
          style={{
            marginTop: "20px",
            padding: "14px 28px",
            border: "none",
            borderRadius: "10px",
            background: "#25d366",
            color: "white",
            fontSize: "16px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Get Started
        </button>
      </div>
    </main>
  );
              }
