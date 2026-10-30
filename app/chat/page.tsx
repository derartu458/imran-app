
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/client";

type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_online: boolean | null;
  last_seen?: string | null;
};

type Message = {
  id: string;
  content: string | null;
  sender_id: string;
  created_at: string;
  message_type?: string;
};

export default function ChatPage() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);

  const [myId, setMyId] = useState("");
  const [myEmail, setMyEmail] = useState("");
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mobileChat, setMobileChat] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [connected, setConnected] = useState(true);

  const getError = (err: any) =>
    err?.message || err?.details || err?.hint || "An unexpected error occurred.";

  // Load all messages from Supabase.
  const loadMessages = useCallback(async (id: string) => {
    if (!id) return;

    const { data, error } = await supabase
      .from("messages")
      .select("id, content, sender_id, created_at, message_type")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      setError("Could not load messages: " + getError(error));
      return;
    }

    setMessages(data || []);
  }, []);

  // Update online status.
  const updateOnlineStatus = useCallback(async (online: boolean, userId: string) => {
    if (!userId) return;

    await supabase
      .from("profiles")
      .update({
        is_online: online,
        last_seen: new Date().toISOString(),
      })
      .eq("id", userId);
  }, []);

  // Load authenticated user and people.
  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          router.replace("/");
          return;
        }

        if (!active) return;

        const currentUser = data.user;

        setMyId(currentUser.id);
        setMyEmail(currentUser.email || "");

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url, is_online, last_seen")
          .eq("id", currentUser.id)
          .maybeSingle();

        if (profileError) throw profileError;

        if (active && profile) setMyProfile(profile);

        await updateOnlineStatus(true, currentUser.id);

        const { data: users, error: usersError } = await supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url, is_online, last_seen")
          .neq("id", currentUser.id)
          .order("full_name", { ascending: true })
          .limit(100);

        if (!active) return;

        if (usersError) {
          setError("Could not load people: " + getError(usersError));
        } else {
          setPeople(users || []);
        }
      } catch (err) {
        if (active) setError(getError(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, updateOnlineStatus]);

  // Detect internet connection and refresh messages when internet returns.
  useEffect(() => {
    const handleOnline = () => {
      setConnected(true);

      if (myId) updateOnlineStatus(true, myId);
      if (conversationId) loadMessages(conversationId);
    };

    const handleOffline = () => {
      setConnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    setConnected(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [myId, conversationId, loadMessages, updateOnlineStatus]);

  // Refresh when user returns to the app.
  useEffect(() => {
    if (!conversationId) return;

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        loadMessages(conversationId);
        if (myId) updateOnlineStatus(true, myId);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [conversationId, myId, loadMessages, updateOnlineStatus]);

  // Periodically check for messages missed while offline.
  useEffect(() => {
    if (!conversationId) return;

    const interval = window.setInterval(() => {
      if (navigator.onLine) {
        loadMessages(conversationId);
      }
    }, 15000);

    return () => window.clearInterval(interval);
  }, [conversationId, loadMessages]);

  // Keep the newest message visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Find an existing private conversation or create one.
  async function openChat(person: Profile) {
    if (!myId || opening) return;

    setOpening(true);
    setError("");
    setSelected(person);
    setMobileChat(true);
    setMessages([]);
    setConversationId("");

    try {
      const { data: memberships, error: membershipError } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", myId);

      if (membershipError) throw membershipError;

      let foundId = "";

      for (const membership of memberships || []) {
        const id = membership.conversation_id;

        const { data: conversation, error: conversationError } =
          await supabase
            .from("conversations")
            .select("id, type")
            .eq("id", id)
            .maybeSingle();

        if (conversationError) throw conversationError;
        if (!conversation || conversation.type !== "private") continue;

        const { data: members, error: membersError } = await supabase
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", id);

        if (membersError) throw membersError;

        const isTwoPersonChat =
          (members || []).some((m) => m.user_id === person.id) &&
          (members || []).some((m) => m.user_id === myId);

        if (isTwoPersonChat && (members || []).length === 2) {
          foundId = id;
          break;
        }
      }

      if (!foundId) {
        const { data: conversation, error: createError } = await supabase
          .from("conversations")
          .insert({
            owner_id: myId,
            type: "private",
            name: null,
          })
          .select("id")
          .single();

        if (createError) throw createError;

        foundId = conversation.id;

        const { error: addMembersError } = await supabase
          .from("conversation_members")
          .insert([
            {
              conversation_id: foundId,
              user_id: myId,
              role: "member",
            },
            {
              conversation_id: foundId,
              user_id: person.id,
              role: "member",
            },
          ]);

        if (addMembersError) throw addMembersError;
      }

      setConversationId(foundId);
      await loadMessages(foundId);
    } catch (err: any) {
      console.error("OPEN CHAT ERROR:", err);
      setError("Could not open chat: " + getError(err));
    } finally {
      setOpening(false);
    }
  }

  // Realtime updates for the selected conversation.
  useEffect(() => {
    if (!conversationId) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel("imran-messages-" + conversationId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: "conversation_id=eq." + conversationId,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = payload.new as Message;

            setMessages((previous) => {
              if (previous.some((m) => m.id === incoming.id)) {
                return previous;
              }

              return [...previous, incoming].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() -
                  new Date(b.created_at).getTime()
              );
            });
          } else {
            loadMessages(conversationId);
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Realtime connection problem. Messages will still refresh from the database.");
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, loadMessages]);

  // Send a message even if the recipient is offline.
  async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const content = message.trim();

    if (!content || !conversationId || !myId || sending) return;

    if (!navigator.onLine) {
      setError("You are offline. Connect to the internet to send this message.");
      return;
    }

    setSending(true);
    setError("");

    try {
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: myId,
          content,
          message_type: "text",
        })
        .select("id, content, sender_id, created_at, message_type")
        .single();

      if (error) throw error;

      setMessage("");

      setMessages((previous) => {
        if (previous.some((m) => m.id === data.id)) return previous;

        return [...previous, data].sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
        );
      });
    } catch (err: any) {
      console.error("SEND MESSAGE ERROR:", err);
      setError("Message not sent: " + getError(err));
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      if (myId) {
        await updateOnlineStatus(false, myId);
      }

      await supabase.auth.signOut();
      router.replace("/");
    } catch (err) {
      setError(getError(err));
      setLoggingOut(false);
    }
  }

  function startCall(type: "audio" | "video") {
    setError(
      `${type === "audio" ? "Audio" : "Video"} calling is not connected yet. WebRTC and call signaling must be implemented before real calls can work.`
    );
  }

  const filteredPeople = people.filter((person) => {
    const name = person.full_name || person.username || "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const displayName = (person: Profile) =>
    person.full_name || person.username || "Imran User";

  const initials = (person: Profile) =>
    displayName(person).charAt(0).toUpperCase();

  if (loading) {
    return (
      <main className="loading">
        <div className="loading-logo">إ</div>
        <h2>Imran</h2>
        <p>Preparing your conversations...</p>
        <style jsx>{`
          .loading {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: #071610;
            color: white;
            font-family: Arial, sans-serif;
          }
          .loading-logo {
            width: 76px;
            height: 76px;
            display: grid;
            place-items: center;
            border-radius: 24px;
            background: linear-gradient(135deg, #40edac, #0c9b70);
            color: #062016;
            font-size: 38px;
            font-weight: bold;
          }
          h2 { color: #40edac; margin-bottom: 0; }
          p { color: #829d91; }
        `}</style>
      </main>
    );
  }

  return (
    <main className="app">
      <aside className={`sidebar ${mobileChat ? "mobile-hidden" : ""}`}>
        <header className="side-header">
          <div className="brand">
            <div className="brand-logo">إ</div>
            <div>
              <h1>Imran</h1>
              <span>Connect with everyone</span>
            </div>
          </div>
          <button className="logout" onClick={logout} disabled={loggingOut}>
            {loggingOut ? "..." : "↪"}
          </button>
        </header>

        <div className="account">
          <div className="my-avatar">
            {myProfile ? initials(myProfile) : "U"}
          </div>
          <div className="account-info">
            <strong>
              {myProfile?.full_name || myProfile?.username || "My Account"}
            </strong>
            <span>{myEmail}</span>
          </div>
          <span className="account-status" />
        </div>

        <div className="connection-status">
          <span className={connected ? "connection-dot" : "connection-dot offline"} />
          {connected ? "Internet connected" : "You are offline"}
        </div>

        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
          />
        </div>

        <div className="list-heading">
          <span>MESSAGES</span>
          <span>{filteredPeople.length} PEOPLE</span>
        </div>

        <div className="people-list">
          {filteredPeople.map((person) => (
            <button
              key={person.id}
              className={`person ${selected?.id === person.id ? "active" : ""}`}
              onClick={() => openChat(person)}
              disabled={opening}
            >
              <div className="avatar-wrap">
                <div className="avatar">
                  {person.avatar_url ? (
                    <img src={person.avatar_url} alt="" />
                  ) : (
                    initials(person)
                  )}
                </div>
                {person.is_online && <span className="online-dot" />}
              </div>

              <div className="person-details">
                <strong>{displayName(person)}</strong>
                <span>{person.is_online ? "Online now" : "Offline"}</span>
              </div>

              <span className="person-arrow">›</span>
            </button>
          ))}

          {filteredPeople.length === 0 && (
            <div className="empty-people">
              <span>👥</span>
              <p>No people found</p>
              <small>New registered users will appear here.</small>
            </div>
          )}
        </div>

        <footer className="side-footer">
          <span className="secure-icon">🔒</span>
          <span>Private and secure messaging</span>
        </footer>
      </aside>

      <section className={`chat-panel ${!mobileChat ? "mobile-hidden" : ""}`}>
        {selected ? (
          <>
            <header className="chat-header">
              <button
                className="back-button"
                onClick={() => setMobileChat(false)}
              >
                ←
              </button>

              <div className="avatar">
                {selected.avatar_url ? (
                  <img src={selected.avatar_url} alt="" />
                ) : (
                  initials(selected)
                )}
              </div>

              <div className="chat-person">
                <strong>{displayName(selected)}</strong>
                <span>{selected.is_online ? "● Online" : "● Offline"}</span>
              </div>

              <div className="call-actions">
                <button onClick={() => startCall("audio")} title="Audio call">
                  ☎
                </button>
                <button onClick={() => startCall("video")} title="Video call">
                  ▣
                </button>
              </div>
            </header>

            <div className="conversation">
              <div className="date-label">PRIVATE CONVERSATION</div>

              {opening ? (
                <div className="conversation-state">
                  Opening conversation...
                </div>
              ) : messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-chat-icon">💬</div>
                  <h2>Start a conversation</h2>
                  <p>Say hello to {displayName(selected)}.</p>
                </div>
              ) : (
                messages.map((item) => {
                  const mine = item.sender_id === myId;

                  return (
                    <div
                      key={item.id}
                      className={`message-row ${mine ? "mine" : "theirs"}`}
                    >
                      <div className="bubble">
                        <p>{item.content}</p>
                        <span>
                          {new Date(item.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {mine ? "  ✓" : ""}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}

              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a message..."
                disabled={!conversationId || opening}
              />
              <button
                className="send-button"
                type="submit"
                disabled={!message.trim() || !conversationId || sending}
              >
                {sending ? "…" : "➤"}
              </button>
            </form>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-logo">إ</div>
            <span className="welcome-tag">YOUR WORLD. YOUR PEOPLE.</span>
            <h2>Welcome to Imran</h2>
            <p>
              A place to connect, communicate and share.
              Choose someone from your contacts to begin a private conversation.
            </p>

            <div className="welcome-features">
              <div><span>💬</span><strong>Private chat</strong></div>
              <div><span>⚡</span><strong>Live messaging</strong></div>
              <div><span>👥</span><strong>People</strong></div>
              <div><span>📞</span><strong>Calls coming next</strong></div>
            </div>
          </div>
        )}

        {error && (
          <div className="error-message">
            <span>⚠ {error}</span>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
      </section>

      <style jsx>{`
        * { box-sizing: border-box; }

        .app {
          display: flex;
          width: 100%;
          height: 100dvh;
          min-height: 550px;
          overflow: hidden;
          background: #071610;
          color: #f1faf5;
          font-family: Arial, sans-serif;
        }

        button { font: inherit; cursor: pointer; }

        .sidebar {
          width: 360px;
          min-width: 310px;
          display: flex;
          flex-direction: column;
          background: #0b1f18;
          border-right: 1px solid #1c4032;
        }

        .side-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 19px;
          border-bottom: 1px solid #1b3b30;
        }

        .brand { display: flex; align-items: center; gap: 12px; }

        .brand-logo, .welcome-logo {
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #47efad, #07986c);
          color: #052016;
          font-weight: bold;
        }

        .brand-logo {
          width: 47px;
          height: 47px;
          border-radius: 15px;
          font-size: 25px;
        }

        .brand h1 {
          margin: 0;
          color: #42e5a4;
          font-size: 23px;
        }

        .brand span {
          display: block;
          margin-top: 4px;
          color: #78998a;
          font-size: 11px;
        }

        .logout {
          width: 39px;
          height: 39px;
          border: 1px solid #315344;
          border-radius: 12px;
          background: #122e23;
          color: #f0a18d;
          font-size: 21px;
        }

        .account {
          display: flex;
          align-items: center;
          gap: 11px;
          margin: 15px;
          padding: 12px;
          border: 1px solid #254a39;
          border-radius: 14px;
          background: #10291f;
        }

        .my-avatar, .avatar {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          border-radius: 50%;
          background: linear-gradient(135deg, #286e51, #174332);
          color: white;
          font-weight: bold;
          overflow: hidden;
        }

        .my-avatar { width: 42px; height: 42px; }

        .account-info, .person-details {
          display: flex;
          flex: 1;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }

        .account-info strong, .account-info span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .account-info strong { font-size: 13px; }
        .account-info span { color: #78998a; font-size: 10px; }

        .account-status, .online-dot, .connection-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #39e6a1;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 18px 14px;
          color: #91b4a2;
          font-size: 11px;
        }

        .connection-dot.offline { background: #ef7777; }

        .search-box {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 15px 16px;
          padding: 12px 14px;
          border: 1px solid #244536;
          border-radius: 12px;
          background: #071a12;
          color: #8eb5a2;
        }

        .search-box span { font-size: 23px; }
        .search-box input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          color: white;
          font-size: 13px;
        }

        .list-heading {
          display: flex;
          justify-content: space-between;
          padding: 0 18px 11px;
          color: #709483;
          font-size: 10px;
          letter-spacing: 1px;
        }

        .people-list { flex: 1; overflow-y: auto; }

        .person {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 17px;
          border: 0;
          border-left: 3px solid transparent;
          background: transparent;
          color: white;
          text-align: left;
        }

        .person:hover, .person.active {
          background: #143729;
          border-left-color: #38d99a;
        }

        .avatar-wrap { position: relative; }

        .avatar { width: 46px; height: 46px; font-size: 16px; }

        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .online-dot {
          position: absolute;
          right: 0;
          bottom: 1px;
          border: 2px solid #0b1f18;
        }

        .person-details strong {
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .person-details span { color: #80a291; font-size: 11px; }
        .person-arrow { color: #628474; font-size: 23px; }

        .empty-people {
          padding: 40px 18px;
          text-align: center;
          color: #819f90;
        }

        .empty-people > span { font-size: 35px; }
        .empty-people p { margin-bottom: 5px; }
        .empty-people small { font-size: 11px; }

        .side-footer {
          display: flex;
          justify-content: center;
          gap: 8px;
          padding: 15px;
          border-top: 1px solid #1b3b30;
          color: #709483;
          font-size: 10px;
        }

        .chat-panel {
          position: relative;
          display: flex;
          flex: 1;
          flex-direction: column;
          min-width: 0;
          background: radial-gradient(ellipse at center, #102d20 0%, #081911 75%);
        }

        .chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 76px;
          padding: 12px 20px;
          border-bottom: 1px solid #214435;
          background: #0b2118;
        }

        .chat-person { flex: 1; }
        .chat-person strong { font-size: 14px; }
        .chat-person span {
          display: block;
          margin-top: 5px;
          color: #38d99a;
          font-size: 11px;
        }

        .call-actions { display: flex; gap: 9px; }

        .call-actions button {
          width: 42px;
          height: 42px;
          border: 1px solid #315a43;
          border-radius: 12px;
          background: #153829;
          color: #48e5a7;
          font-size: 20px;
        }

        .call-actions button:hover { background: #20533b; }

        .back-button {
          display: none;
          border: 0;
          background: transparent;
          color: #4ae4a8;
          font-size: 24px;
        }

        .conversation {
          display: flex;
          flex: 1;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
          padding: 22px clamp(12px, 5vw, 65px);
        }

        .date-label {
          align-self: center;
          padding: 7px 12px;
          border: 1px solid #294938;
          border-radius: 20px;
          background: #10291d;
          color: #86a997;
          font-size: 9px;
          letter-spacing: 1px;
        }

        .conversation-state {
          margin: auto;
          color: #8ba999;
        }

        .empty-chat {
          margin: auto;
          text-align: center;
          color: #8ba999;
        }

        .empty-chat-icon { font-size: 48px; }
        .empty-chat h2 { color: white; font-size: 21px; }
        .empty-chat p { font-size: 13px; }

        .message-row { display: flex; width: 100%; }
        .message-row.mine { justify-content: flex-end; }
        .message-row.theirs { justify-content: flex-start; }

        .bubble {
          max-width: min(75%, 500px);
          padding: 11px 14px 8px;
          border: 1px solid #28543c;
          border-radius: 15px;
          background: #153629;
          overflow-wrap: anywhere;
        }

        .mine .bubble {
          border-color: #167d56;
          border-bottom-right-radius: 4px;
          background: linear-gradient(135deg, #126a48, #105b40);
        }

        .theirs .bubble { border-bottom-left-radius: 4px; }

        .bubble p {
          margin: 0 0 7px;
          color: #f2fff7;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .bubble span {
          display: block;
          color: #b4d6c3;
          text-align: right;
          font-size: 9px;
        }

        .composer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          border-top: 1px solid #214435;
          background: #0b2118;
        }

        .composer input {
          flex: 1;
          min-width: 0;
          padding: 14px 16px;
          border: 1px solid #294a39;
          border-radius: 13px;
          outline: none;
          background: #071a12;
          color: white;
          font-size: 14px;
        }

        .composer input:focus { border-color: #35d99a; }

        .send-button {
          width: 48px;
          height: 48px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(135deg, #48e9a8, #14aa76);
          color: #052016;
          font-size: 22px;
          font-weight: bold;
        }

        .send-button:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }

        .welcome {
          width: min(580px, 90%);
          margin: auto;
          text-align: center;
        }

        .welcome-logo {
          width: 95px;
          height: 95px;
          margin: 0 auto 22px;
          border-radius: 28px;
          font-size: 48px;
          box-shadow: 0 15px 50px #1caa6b25;
        }

        .welcome-tag {
          color: #44dba0;
          font-size: 10px;
          letter-spacing: 2px;
        }

        .welcome h2 { margin: 12px 0; font-size: 32px; }
        .welcome > p {
          color: #8ba999;
          font-size: 14px;
          line-height: 1.8;
        }

        .welcome-features {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-top: 28px;
        }

        .welcome-features div {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border: 1px solid #294a39;
          border-radius: 13px;
          background: #10291d;
          text-align: left;
        }

        .welcome-features span { font-size: 22px; }
        .welcome-features strong { font-size: 12px; }

        .error-message {
          position: absolute;
          right: 15px;
          bottom: 82px;
          left: 15px;
          z-index: 5;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 13px 15px;
          border: 1px solid #a94d48;
          border-radius: 12px;
          background: #542b29;
          color: #ffe2dd;
          font-size: 12px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .error-message button {
          flex-shrink: 0;
          border: 0;
          background: transparent;
          color: white;
          font-size: 21px;
        }

        @media (max-width: 700px) {
          .sidebar { width: 100%; min-width: 0; }
          .chat-panel { width: 100%; }
          .mobile-hidden { display: none; }
          .back-button { display: block; }
          .chat-header { padding: 10px 12px; }
          .conversation { padding: 15px 10px; }
          .composer { padding: 10px; }
          .welcome h2 { font-size: 25px; }
        }

        @media (min-width: 701px) {
          .sidebar { max-width: 390px; }
        }
      `}</style>
    </main>
  );
}
