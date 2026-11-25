import React, { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { apiRequest } from "../services/api";

const suggestions = [
  "What is my outstanding balance?",
  "When is my next invoice due?",
  "How do I download a receipt?"
];

export default function CustomerAuronAssistant({
  token,
  darkMode,
  onSessionExpired
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([{
    role: "assistant",
    text: "Hi, I’m Auron. I can help explain your plans, invoices, payment status, outstanding balance and billing documents."
  }]);
  const scrollContainer = useRef(null);
  const sessionExpiredRef = useRef(onSessionExpired);

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);
  const dark = darkMode;
  const panel = dark
    ? "border-[#333] bg-[#171717] text-white"
    : "border-slate-200 bg-white text-slate-900";
  const muted = dark ? "text-slate-400" : "text-slate-600";
  const surface = dark ? "bg-[#222] border-[#333]" : "bg-slate-50 border-slate-200";

  useEffect(() => {
    let active = true;
    apiRequest("/api/customer-portal/assistant/history", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((response) => {
        if (active && response.messages?.length) {
          setMessages(response.messages.map((item) => ({
            role: item.role,
            text: item.content
          })));
        }
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.status === 401) sessionExpiredRef.current();
        else setError(requestError.message || "Conversation history could not be loaded.");
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    scrollContainer.current?.scrollTo({
      top: scrollContainer.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, open]);

  const ask = async (prompt = input) => {
    const message = prompt.trim();
    if (!message || busy || loadingHistory) return;
    setInput("");
    setError("");
    setMessages((items) => [...items, { role: "user", text: message }]);
    setBusy(true);
    try {
      const response = await apiRequest("/api/customer-portal/assistant/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message })
      });
      setMessages((items) => [...items, { role: "assistant", text: response.reply }]);
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else {
        setError(requestError.message || "Auron could not answer right now.");
        setMessages((items) => items.slice(0, -1));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customer-auron-widget">
      {open && (
        <section
          aria-label="Auron customer assistant"
          className={`customer-auron-window fixed z-50 flex flex-col overflow-hidden rounded-2xl border shadow-2xl ${panel}`}
        >
          <header className="flex items-center justify-between border-b border-inherit bg-[#e50914] px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
                <img src="/auron-logo.png" alt="" className="h-7 w-7 object-contain" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold">Auron AI Assistant</h2>
                <p className="text-[10px] text-white/80">Secure, account-aware support</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid min-h-10 min-w-10 place-items-center rounded-lg hover:bg-white/15"
              aria-label="Close Auron assistant"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div
            ref={scrollContainer}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            aria-live="polite"
          >
            {messages.map((item, index) => (
              <div
                key={`${item.role}-${index}`}
                className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-xs leading-relaxed ${
                  item.role === "user"
                    ? "rounded-br-md bg-[#e50914] text-white"
                    : `${surface} rounded-bl-md border`
                }`}>
                  {item.role === "assistant" && (
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-[#e50914]">
                      <Sparkles className="h-3 w-3" /> Auron
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{item.text}</p>
                </div>
              </div>
            ))}
            {loadingHistory && (
              <p className={`text-xs ${muted}`} role="status">Loading your conversation…</p>
            )}
            {busy && (
              <p className={`text-xs ${muted}`} role="status">Auron is checking your account…</p>
            )}
          </div>

          {messages.length === 1 && !loadingHistory && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => ask(suggestion)}
                  disabled={busy}
                  className={`rounded-full border px-3 py-2 text-[10px] ${surface} disabled:opacity-50`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {error && <p role="alert" className="px-4 pb-2 text-xs text-rose-500">{error}</p>}
          <form
            className={`flex items-center gap-2 border-t p-3 ${dark ? "border-[#333]" : "border-slate-200"}`}
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={500}
              aria-label="Ask Auron a question"
              placeholder="Ask about your billing…"
              className={`min-w-0 flex-1 rounded-xl border px-3 py-3 text-xs outline-none focus:border-[#e50914] ${surface}`}
            />
            <button
              type="submit"
              disabled={busy || loadingHistory || !input.trim()}
              aria-label="Send message"
              className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-[#e50914] text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className={`px-4 pb-3 text-[9px] ${muted}`}>
            Auron explains account information but cannot authorize or initiate payments.
          </p>
        </section>
      )}

      {!open && (
        <button
          type="button"
          aria-label="Open Auron AI Assistant"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex min-h-14 items-center gap-2 rounded-full bg-[#e50914] px-4 text-sm font-bold text-white shadow-xl shadow-rose-900/20 hover:bg-[#c90711] sm:bottom-6 sm:right-6"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15">
            <Bot className="h-4 w-4" />
          </span>
          <span>Auron AI</span>
        </button>
      )}
    </div>
  );
}
