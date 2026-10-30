
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/client";

type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_online: boolean | null;
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

  const [myId, setMyId] = useState("");
  const [myEmail, setMyEmail] = useState("");
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function start() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace("/");
        return;
      }

      if (!active) return;

      setMyId(data.user.id);
      setMyEmail(data.user.email || "");

      await supabase
        .from("profiles")
        .update({
          is_online: true,
          last_seen: new Date().toISOString(),
        })
        .eq("id", data.user.id);

      const { data: users, error: usersError } = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url, is_online")
        .neq("id", data.user.id)
        .order("full_name", { ascending: true });

      if (!active) return;

      if (usersError) {
        setError(usersError.message);
      } else {
        setPeople(users || []);
      }

      setLoading(false);
    }

    start();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openChat(person: Profile) {
    setSelected(person);
    setMessages([]);
    setConversationId("");
    setError("");

    try {
      // Find conversations where I am a member.
      const { data: myMemberships, error: memberError } =
        await supabase
          .from("conversation_members")
          .select("conversation_id")
          .eq("user_id", myId);

      if (memberError) throw memberError;

      let existingId = "";

      for (const membership of myMemberships || []) {
        const { data: conversation, error: conversationError } =
          await supabase
            .from("conversations")
            .select("id, type")
            .eq("id", membership.conversation_id)
            .maybeSingle();

        if (conversationError) throw conversationError;
        if (!conversation || conversation.type !== "private") continue;

        const { data: members, error: otherMemberError } =
          await supabase
            .from("conversation_members")
            .select("user_id")
            .eq("conversation_id", membership.conversation_id);

        if (otherMemberError) throw otherMemberError;

        const hasOtherPerson = (members || []).some(
          (member) => member.user_id === person.id
        );

        if (hasOtherPerson) {
          existingId = membership.conversation_id;
          break;
        }
      }

      // Create a private conversation if one does not exist.
      if (!existingId) {
        const { data: conversation, error: createError } =
          await supabase
            .from("conversations")
            .insert({
              owner_id: myId,
              type: "private",
              name: null,
            })
            .select("id")
            .single();

        if (createError) throw createError;

        existingId = conversation.id;

        const { error: addMembersError } = await supabase
          .from("conversation_members")
          .insert([
            {
              conversation_id: existingId,
              user_id: myId,
              role: "member",
            },
            {
              conversation_id: existingId,
              user_id: person.id,
              role: "member",
            },
          ]);

        if (addMembersError) throw addMembersError;
      }

      setConversationId(existingId);
      await loadMessages(existingId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not open chat."
      );
    }
  }

  async function loadMessages(id: string) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, content, sender_id, created_at, message_type")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      setError(error.message);
      return;
    }

    setMessages(data || []);
  }

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel("messages-" + conversationId)
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
            const newMessage = payload.new as Message;

            setMessages((current) => {
              if (current.some((item) => item.id === newMessage.id)) {
                return current;
              }
              return [...current, newMessage];
            });
          } else {
            loadMessages(conversationId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const content = message.trim();

    if (!content || !conversationId || sending) return;

    setSending(true);
    setError("");

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

    if (error) {
      setError(error.message);
    } else {
      setMessage("");
      setMessages((current) => {
        if (current.some((item) => item.id === data.id)) {
          return current;
        }
        return [...current, data];
      });
    }

    setSending(false);
  }

  async function logout() {
    await supabase
      .from("profiles")
      .update({
        is_online: false,
        last_seen: new Date().toISOString(),
      })
      .eq("id", myId);

    await supabase.auth.signOut();
    router.replace("/");
  }

  const filteredPeople = people.filter((person) =>
    (person.full_name || person.username || "")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <main className="loading">
        <div className="logo">إ</div>
        <h2>Loading Imran...</h2>
        <style jsx>{`
          .loading {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: #061510;
            color: #35d69a;
            font-family: Arial;
          }
          .logo {
            background: #29d994;
            color: #061510;
            padding: 20px;
            border-radius: 20px;
            font-size: 35px;
          }
        `}</style>
      </main>
    );
  }

  return (
    <main className="app">
      <aside className="sidebar">
        <header className="header">
          <div className="brand">
            <div className="logo">إ</div>
            <div>
              <h1>Imran</h1>
              <small>Messenger</small>
            </div>
          </div>
          <button onClick={logout} className="logout">
            Logout ↪
          </button>
        </header>

        <div className="search">
          🔎
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
          />
        </div>

        <div className="section-title">PEOPLE</div>

        <div className="people">
          {filteredPeople.map((person) => (
            <button
              key={person.id}
              className={`person ${
                selected?.id === person.id ? "selected" : ""
              }`}
              onClick={() => openChat(person)}
            >
              <div className="avatar">
                {person.avatar_url ? (
                  <img src={person.avatar_url} alt="" />
                ) : (
                  (person.full_name || person.username || "U")
                    .charAt(0)
                    .toUpperCase()
                )}
                {person.is_online && <i />}
              </div>

              <div className="person-info">
                <strong>
                  {person.full_name ||
                    person.username ||
                    "Imran User"}
                </strong>
                <small>
                  {person.is_online ? "Online" : "Offline"}
                </small>
              </div>
              <span>›</span>
            </button>
          ))}

          {filteredPeople.length === 0 && (
            <p className="empty">No people found.</p>
          )}
        </div>

        <footer className="my-account">
          <div className="avatar">U</div>
          <div>
            <strong>My Account</strong>
            <small>{myEmail}</small>
          </div>
        </footer>
      </aside>

      <section className="chat-area">
        {selected ? (
          <>
            <header className="chat-header">
              <div className="avatar">
                {(selected.full_name ||
                  selected.username ||
                  "U").charAt(0).toUpperCase()}
              </div>
              <div>
                <strong>
                  {selected.full_name ||
                    selected.username ||
                    "Imran User"}
                </strong>
                <small>
                  {selected.is_online ? "Online" : "Offline"}
                </small>
              </div>
              <div className="call-buttons">
                <button
                  title="Audio call"
                  onClick={() =>
                    setError("Audio calling will be added in the next stage.")
                  }
                >
                  📞
                </button>
                <button
                  title="Video call"
                  onClick={() =>
                    setError("Video calling will be added in the next stage.")
                  }
                >
                  📹
                </button>
              </div>
            </header>

            <div className="messages">
              {messages.length === 0 ? (
                <div className="no-messages">
                  <span>💬</span>
                  <h2>Start your conversation</h2>
                  <p>Send your first message to this person.</p>
                </div>
              ) : (
                messages.map((item) => (
                  <div
                    key={item.id}
                    className={`message ${
                      item.sender_id === myId ? "mine" : "theirs"
                    }`}
                  >
                    <p>{item.content}</p>
                    <small>
                      {new Date(item.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a message..."
              />
              <button disabled={sending || !message.trim()}>
                {sending ? "..." : "➤"}
              </button>
            </form>
          </>
        ) : (
          <div className="welcome">
            <div className="big-logo">إ</div>
            <h2>Welcome to Imran</h2>
            <p>Select a person to start a private conversation.</p>
            <div className="features">
              <span>💬 Private messages</span>
              <span>👥 Connect with people</span>
              <span>📞 Audio calls (coming next)</span>
              <span>📹 Video calls (coming next)</span>
            </div>
          </div>
        )}

        {error && (
          <div className="error">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
      </section>

      <style jsx>{`
        * {
          box-sizing: border-box;
        }

        .app {
          min-height: 100vh;
          display: flex;
          background: #061510;
          color: white;
          font-family: Arial, sans-serif;
        }

        .sidebar {
          width: 350px;
          min-width: 300px;
          display: flex;
          flex-direction: column;
          background: #0b211a;
          border-right: 1px solid #254b3e;
          height: 100vh;
        }

        .header {
          padding: 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #254b3e;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo,
        .big-logo {
          display: flex;
          justify-content: center;
          align-items: center;
          background: linear-gradient(135deg, #35e7a0, #0b956a);
          color: #061510;
          font-weight: bold;
        }

        .logo {
          width: 45px;
          height: 45px;
          border-radius: 14px;
          font-size: 25px;
        }

        h1 {
          margin: 0;
          color: #35d69a;
          font-size: 23px;
        }

        .brand small,
        .chat-header small {
          display: block;
          color: #82a497;
          margin-top: 4px;
        }

        button {
          cursor: pointer;
        }

        .logout {
          border: 0;
          border-radius: 8px;
          background: #183a2e;
          color: #f19a88;
          padding: 9px;
        }

        .search {
          margin: 16px;
          padding: 13px;
          display: flex;
          gap: 10px;
          background: #061812;
          border: 1px solid #294e42;
          border-radius: 12px;
        }

        .search input,
        .composer input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          color: white;
        }

        .section-title {
          padding: 5px 18px 12px;
          font-size: 11px;
          color: #6e9586;
          letter-spacing: 1px;
        }

        .people {
          flex: 1;
          overflow-y: auto;
        }

        .person {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 13px 17px;
          background: transparent;
          border: 0;
          color: white;
          text-align: left;
        }

        .person:hover,
        .person.selected {
          background: #153b2e;
        }

        .avatar {
          width: 45px;
          height: 45px;
          min-width: 45px;
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
          border-radius: 50%;
          background: #1c6249;
          font-weight: bold;
          overflow: hidden;
        }

        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .avatar i {
          position: absolute;
          width: 11px;
          height: 11px;
          right: 1px;
          bottom: 1px;
          border: 2px solid #0b211a;
          border-radius: 50%;
          background: #35e49a;
        }

        .person-info {
          flex: 1;
          min-width: 0;
        }

        .person-info strong,
        .person-info small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .person-info small {
          color: #79a092;
          margin-top: 5px;
        }

        .empty {
          padding: 20px;
          color: #82a497;
        }

        .my-account {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 14px;
          border-top: 1px solid #254b3e;
          overflow: hidden;
        }

        .my-account small {
          display: block;
          color: #77988b;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 210px;
          margin-top: 4px;
        }

        .chat-area {
          flex: 1;
          min-width: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          background:
            radial-gradient(circle at center, #103326, #061510 75%);
        }

        .chat-header {
          min-height: 75px;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          background: #0b211a;
          border-bottom: 1px solid #254b3e;
        }

        .call-buttons {
          margin-left: auto;
          display: flex;
          gap: 10px;
        }

        .call-buttons button {
          border: 0;
          border-radius: 10px;
          padding: 10px;
          background: #174532;
          color: #35d69a;
          font-size: 19px;
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .message {
          max-width: 75%;
          padding: 11px 14px;
          border-radius: 14px;
          overflow-wrap: anywhere;
        }

        .message p {
          margin: 0 0 6px;
          line-height: 1.45;
        }

        .message small {
          display: block;
          text-align: right;
          color: #a3c5b7;
          font-size: 10px;
        }

        .mine {
          align-self: flex-end;
          background: #126b4b;
          border-bottom-right-radius: 4px;
        }

        .theirs {
          align-self: flex-start;
          background: #19392e;
          border-bottom-left-radius: 4px;
        }

        .composer {
          display: flex;
          gap: 12px;
          padding: 15px;
          background: #0b211a;
          border-top: 1px solid #254b3e;
        }

        .composer input {
          padding: 13px;
          border-radius: 12px;
          background: #061812;
        }

        .composer button {
          width: 48px;
          min-width: 48px;
          border: 0;
          border-radius: 12px;
          background: #2cdb96;
          color: #061510;
          font-size: 22px;
          font-weight: bold;
        }

        .composer button:disabled {
          opacity: 0.5;
        }

        .welcome,
        .no-messages {
          margin: auto;
          padding: 25px;
          text-align: center;
          color: #8eaea1;
        }

        .big-logo {
          width: 90px;
          height: 90px;
          margin: 0 auto 20px;
          border-radius: 27px;
          font-size: 45px;
        }

        .welcome h2,
        .no-messages h2 {
          color: white;
        }

        .features {
          display: grid;
          gap: 12px;
          margin-top: 25px;
        }

        .features span {
          padding: 12px;
          border: 1px solid #285442;
          border-radius: 10px;
          background: #0b211a;
        }

        .error {
          position: absolute;
          bottom: 85px;
          left: 15px;
          right: 15px;
          padding: 12px;
          background: #632e2e;
          border-radius: 10px;
          color: white;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          overflow-wrap: anywhere;
        }

        .error button {
          border: 0;
          background: transparent;
          color: white;
          font-size: 20px;
        }

        @media (max-width: 700px) {
          .sidebar {
            width: 115px;
            min-width: 115px;
          }

          .header {
            padding: 12px 8px;
            flex-direction: column;
            gap: 10px;
          }

          .brand {
            flex-direction: column;
            gap: 4px;
          }

          .brand h1 {
            font-size: 17px;
          }

          .brand small {
            display: none;
          }

          .logout {
            font-size: 10px;
          }

          .search {
            margin: 8px;
            padding: 9px 5px;
          }

          .search input {
            min-width: 0;
            font-size: 10px;
          }

          .section-title {
            padding: 8px;
            font-size: 9px;
          }

          .person {
            padding: 12px 5px;
            flex-direction: column;
            gap: 5px;
            text-align: center;
          }

          .person-info strong {
            font-size: 10px;
          }

          .person-info small {
            font-size: 9px;
          }

          .person > span {
            display: none;
          }

          .my-account {
            padding: 8px 3px;
            flex-direction: column;
            text-align: center;
          }

          .my-account small {
            display: none;
          }

          .my-account strong {
            font-size: 9px;
          }

          .chat-header {
            padding: 10px;
          }

          .chat-header strong {
            font-size: 12px;
          }

          .messages {
            padding: 12px 8px;
          }

          .message {
            max-width: 90%;
          }
        }
      `}</style>
    </main>
  );
}
