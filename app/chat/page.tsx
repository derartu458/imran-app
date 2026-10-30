
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  const openingRef = useRef(false);

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
    err?.message || err?.details || "An unexpected error occurred.";

  // Load messages saved in Supabase.
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

  // Update this user's online status.
  const updateOnlineStatus = useCallback(
    async (online: boolean, userId: string) => {
      if (!userId || !navigator.onLine) return;

      const { error } = await supabase
        .from("profiles")
        .update({
          is_online: online,
          last_seen: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) console.error("ONLINE STATUS:", error.message);
    },
    []
  );

  // Initialize authenticated user and contacts.
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

        const user = data.user;

        setMyId(user.id);
        setMyEmail(user.email || "");

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url, is_online, last_seen")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        if (active && profile) setMyProfile(profile);

        await updateOnlineStatus(true, user.id);

        const { data: users, error: usersError } = await supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url, is_online, last_seen")
          .neq("id", user.id)
          .order("full_name", { ascending: true })
          .limit(100);

        if (usersError) throw usersError;

        if (active) setPeople(users || []);
      } catch (err: any) {
        if (active) setError("Initialization failed: " + getError(err));
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

  // Internet connection detection.
  useEffect(() => {
    const handleOnline = () => {
      setConnected(true);
      if (myId) updateOnlineStatus(true, myId);
      if (conversationId) loadMessages(conversationId);
    };

    const handleOffline = () => setConnected(false);

    setConnected(navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [myId, conversationId, loadMessages, updateOnlineStatus]);

  // Refresh messages when the app becomes visible again.
  useEffect(() => {
    if (!conversationId) return;

    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        loadMessages(conversationId);
        updateOnlineStatus(true, myId);
      }
    };

    document.addEventListener("visibilitychange", refresh);

    return () => document.removeEventListener("visibilitychange", refresh);
  }, [conversationId, myId, loadMessages, updateOnlineStatus]);

  // Poll for messages in case realtime is unavailable.
  useEffect(() => {
    if (!conversationId) return;

    const timer = window.setInterval(() => {
      if (navigator.onLine) loadMessages(conversationId);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Find an existing private conversation or create one.
  async function openChat(person: Profile) {
    if (!myId || openingRef.current) return;

    openingRef.current = true;
    setOpening(true);
    setError("");
    setSelected(person);
    setMobileChat(true);
    setMessages([]);
    setConversationId("");

    try {
      if (!navigator.onLine) {
        throw new Error("Connect to the internet before opening a chat.");
      }

      // Get conversations where the current user is a member.
      const { data: memberships, error: membershipError } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", myId);

      if (membershipError) throw membershipError;

      let foundId = "";

      // Check whether a private chat with this person already exists.
      for (const membership of memberships || []) {
        const id = membership.conversation_id;

        const { data: members, error: membersError } = await supabase
          .from("conversation_members")
          .select("user_id")
          .eq("conversation_id", id);

        if (membersError) throw membersError;

        const memberIds = (members || []).map((m) => m.user_id);

        if (
          memberIds.length === 2 &&
          memberIds.includes(myId) &&
          memberIds.includes(person.id)
        ) {
          const { data: conversation, error: conversationError } =
            await supabase
              .from("conversations")
              .select("id, type")
              .eq("id", id)
              .maybeSingle();

          if (conversationError) throw conversationError;

          if (conversation?.type === "private") {
            foundId = id;
            break;
          }
        }
      }

      // Create a new private conversation if one does not exist.
      if (!foundId) {
        const { data: conversation, error: createError } = await supabase
          .from("conversations")
          .insert({
            created_by: myId,
            owner_id: myId,
            type: "private",
            name: null,
          })
          .select("id")
          .single();

        if (createError) throw createError;

        foundId = conversation.id;

        // Add both participants.
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

        if (addMembersError) {
          console.error("ADD MEMBERS:", addMembersError);
          throw addMembersError;
        }
      }

      setConversationId(foundId);
      await loadMessages(foundId);
    } catch (err: any) {
      console.error("OPEN CHAT ERROR:", err);
      setError("Could not open chat: " + getError(err));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  // Realtime messages.
  useEffect(() => {
    if (!conversationId) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel("imran-chat-" + conversationId)
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
          console.warn("Realtime unavailable. Database refresh remains active.");
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, loadMessages]);

  // Send and save a message.
  async function sendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const content = message.trim();

    if (!content || !conversationId || !myId || sending) return;

    if (!navigator.onLine) {
      setError("You are offline. Connect to the internet to send messages.");
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
        return [...previous, data];
      });
    } catch (err: any) {
      setError("Message not sent: " + getError(err));
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      await updateOnlineStatus(false, myId);
      await supabase.auth.signOut();
      router.replace("/");
    } catch (err: any) {
      setError(getError(err));
      setLoggingOut(false);
    }
  }

  function displayName(person: Profile) {
    return person.full_name || person.username || "Imran User";
  }

  function initials(person: Profile) {
    return displayName(person).charAt(0).toUpperCase();
  }

  function startCall(type: "audio" | "video") {
    setError(
      `${type === "audio" ? "Audio" : "Video"} calling needs WebRTC and call signaling. This feature is not implemented yet.`
    );
  }

  const filteredPeople = people.filter((person) => {
    const name = displayName(person).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  if (loading) {
    return (
      <main className="loading">
        <div className="logo">إ</div>
        <h1>Imran</h1>
        <p>Preparing your conversations...</p>
        <style jsx>{`
          .loading {
            min-height: 100dvh;
            display: grid;
            place-content: center;
            justify-items: center;
            background: #071711;
            color: white;
            font-family: Arial, sans-serif;
          }
          .logo {
            display: grid;
            place-items: center;
            width: 76px;
            height: 76px;
            border-radius: 25px;
            background: linear-gradient(135deg, #55edb0, #08a875);
            color: #052116;
            font-size: 38px;
            font-weight: bold;
          }
          h1 { color: #55edb0; margin-bottom: 0; }
          p { color: #91aa9d; }
        `}</style>
      </main>
    );
  }

  return (
    <main className="app">
      <aside className={`sidebar ${mobileChat ? "hide-mobile" : ""}`}>
        <header className="side-header">
          <div className="brand">
            <div className="brand-logo">إ</div>
            <div>
              <h1>Imran</h1>
              <span>Messages that connect us</span>
            </div>
          </div>
          <button
            className="icon-button logout"
            onClick={logout}
            disabled={loggingOut}
            title="Logout"
          >
            {loggingOut ? "…" : "↪"}
          </button>
        </header>

        <div className="my-account">
          <div className="avatar my-avatar">
            {myProfile ? initials(myProfile) : "U"}
          </div>
          <div className="account-info">
            <strong>
              {myProfile?.full_name || myProfile?.username || "My Account"}
            </strong>
            <span>{myEmail}</span>
          </div>
          <span className="online-indicator" />
        </div>

        <div className="connection">
          <span className={connected ? "status-dot" : "status-dot offline"} />
          {connected ? "Connected" : "Offline"}
        </div>

        <div className="search">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
          />
        </div>

        <div className="section-heading">
          <span>CONTACTS</span>
          <span>{filteredPeople.length}</span>
        </div>

        <div className="people-list">
          {filteredPeople.map((person) => (
            <button
              key={person.id}
              className={`person ${
                selected?.id === person.id ? "active" : ""
              }`}
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
                {person.is_online && <span className="online-indicator" />}
              </div>

              <div className="person-info">
                <strong>{displayName(person)}</strong>
                <span>{person.is_online ? "Online" : "Offline"}</span>
              </div>

              <span className="arrow">›</span>
            </button>
          ))}

          {filteredPeople.length === 0 && (
            <div className="empty-people">
              <span>👥</span>
              <strong>No contacts found</strong>
              <p>Other registered users will appear here.</p>
            </div>
          )}
        </div>

        <footer className="side-footer">
          <span>🔒</span>
          Private messaging
        </footer>
      </aside>

      <section className={`chat-panel ${!mobileChat ? "hide-mobile" : ""}`}>
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

              <div className="chat-user">
                <strong>{displayName(selected)}</strong>
                <span>
                  {selected.is_online ? "● Online" : "● Offline"}
                </span>
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
              <div className="date-label">PRIVATE CHAT</div>

              {opening ? (
                <div className="state">Opening conversation...</div>
              ) : messages.length === 0 ? (
                <div className="empty-chat">
                  <div>💬</div>
                  <h2>Start a conversation</h2>
                  <p>Send your first message to {displayName(selected)}.</p>
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
                type="submit"
                className="send-button"
                disabled={!message.trim() || !conversationId || sending}
              >
                {sending ? "…" : "➤"}
              </button>
            </form>
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-logo">إ</div>
            <span className="eyebrow">YOUR WORLD. YOUR PEOPLE.</span>
            <h2>Welcome to Imran</h2>
            <p>
              Connect with your people, share ideas and keep every
              conversation close. Select a contact to start chatting.
            </p>

            <div className="features">
              <div><span>💬</span><strong>Private chats</strong></div>
              <div><span>⚡</span><strong>Live messages</strong></div>
              <div><span>👥</span><strong>Your contacts</strong></div>
              <div><span>📞</span><strong>Calls coming soon</strong></div>
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner">
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
          min-height: 500px;
          overflow: hidden;
          background: #071711;
          color: #f3fff8;
          font-family: Arial, sans-serif;
        }

        button { font: inherit; cursor: pointer; }

        .sidebar {
          width: 350px;
          min-width: 300px;
          display: flex;
          flex-direction: column;
          background: #0b2018;
          border-right: 1px solid #1d4031;
        }

        .side-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px;
          border-bottom: 1px solid #1d4031;
        }

        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-logo, .welcome-logo {
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #55edb0, #08a875);
          color: #052116;
          font-weight: bold;
        }

        .brand-logo {
          width: 46px;
          height: 46px;
          border-radius: 15px;
          font-size: 25px;
        }

        .brand h1 { margin: 0; color: #55edb0; font-size: 23px; }
        .brand span {
          display: block;
          margin-top: 4px;
          color: #829e90;
          font-size: 11px;
        }

        .icon-button {
          width: 40px;
          height: 40px;
          border: 1px solid #315744;
          border-radius: 12px;
          background: #122e22;
          color: #f2a28c;
          font-size: 21px;
        }

        .my-account {
          display: flex;
          align-items: center;
          gap: 11px;
          margin: 15px;
          padding: 12px;
          border: 1px solid #254b38;
          border-radius: 15px;
          background: #102a1e;
        }

        .avatar {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          width: 46px;
          height: 46px;
          overflow: hidden;
          border-radius: 50%;
          background: linear-gradient(135deg, #327c58, #17432f);
          color: white;
          font-weight: bold;
        }

        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .my-avatar { width: 43px; height: 43px; }

        .account-info, .person-info {
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

        .account-info strong, .person-info strong { font-size: 13px; }
        .account-info span { color: #829e90; font-size: 10px; }

        .online-indicator, .status-dot {
          width: 9px;
          height: 9px;
          flex-shrink: 0;
          border-radius: 50%;
          background: #43e5a1;
        }

        .connection {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 18px 14px;
          color: #91b4a2;
          font-size: 11px;
        }

        .status-dot.offline { background: #e87979; }

        .search {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0 15px 16px;
          padding: 11px 14px;
          border: 1px solid #284b39;
          border-radius: 12px;
          background: #071a12;
          color: #91b4a2;
        }

        .search span { font-size: 23px; }
        .search input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          color: white;
          font-size: 13px;
        }

        .section-heading {
          display: flex;
          justify-content: space-between;
          padding: 0 18px 11px;
          color: #779887;
          font-size: 10px;
          letter-spacing: 1px;
        }

        .people-list { flex: 1; overflow-y: auto; }

        .person {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 12px 17px;
          border: 0;
          border-left: 3px solid transparent;
          background: transparent;
          color: white;
          text-align: left;
        }

        .person:hover, .person.active {
          background: #153a29;
          border-left-color: #4be4a7;
        }

        .person:disabled { opacity: .6; }
        .avatar-wrap { position: relative; }

        .avatar-wrap .online-indicator {
          position: absolute;
          right: 0;
          bottom: 1px;
          border: 2px solid #0b2018;
        }

        .person-info span { color: #85a494; font-size: 11px; }
        .arrow { color: #739484; font-size: 23px; }

        .empty-people {
          display: grid;
          justify-items: center;
          gap: 9px;
          padding: 40px 15px;
          color: #91aa9d;
          text-align: center;
        }

        .empty-people span { font-size: 35px; }
        .empty-people p { margin: 0; font-size: 11px; }

        .side-footer {
          display: flex;
          justify-content: center;
          gap: 8px;
          padding: 15px;
          border-top: 1px solid #1d4031;
          color: #789989;
          font-size: 10px;
        }

        .chat-panel {
          position: relative;
          display: flex;
          flex: 1;
          flex-direction: column;
          min-width: 0;
          background: radial-gradient(ellipse at center, #102e20, #081911 75%);
        }

        .chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 76px;
          padding: 12px 20px;
          border-bottom: 1px solid #234735;
          background: #0b2118;
        }

        .chat-user { flex: 1; }
        .chat-user strong { font-size: 14px; }
        .chat-user span {
          display: block;
          margin-top: 5px;
          color: #43e5a1;
          font-size: 11px;
        }

        .call-actions { display: flex; gap: 9px; }
        .call-actions button {
          width: 42px;
          height: 42px;
          border: 1px solid #315a43;
          border-radius: 12px;
          background: #153829;
          color: #55edb0;
          font-size: 20px;
        }

        .back-button {
          display: none;
          border: 0;
          background: transparent;
          color: #55edb0;
          font-size: 25px;
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

        .state, .empty-chat { margin: auto; text-align: center; }
        .state { color: #8ba999; }
        .empty-chat { color: #8ba999; }
        .empty-chat > div { font-size: 48px; }
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
          background: linear-gradient(135deg, #55edb0, #14aa76);
          color: #052016;
          font-size: 22px;
          font-weight: bold;
        }

        .send-button:disabled { opacity: .45; cursor: not-allowed; }

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

        .eyebrow {
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

        .features {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-top: 28px;
        }

        .features div {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border: 1px solid #294a39;
          border-radius: 13px;
          background: #10291d;
          text-align: left;
        }

        .features span { font-size: 22px; }
        .features strong { font-size: 12px; }

        .error-banner {
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

        .error-banner button {
          flex-shrink: 0;
          border: 0;
          background: transparent;
          color: white;
          font-size: 21px;
        }

        @media (max-width: 700px) {
          .sidebar { width: 100%; min-width: 0; }
          .chat-panel { width: 100%; }
          .hide-mobile { display: none; }
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
