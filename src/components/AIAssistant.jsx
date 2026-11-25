import React from 'react';
import { Sparkles, X, Send } from 'lucide-react';

export default function AIAssistant({
  aiOpen,
  setAiOpen,
  aiInput,
  setAiInput,
  aiMessages,
  handleAskAI,
  bgCard,
  bgSurface,
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-40">
      {aiOpen && (
        <div className={`mb-2 p-4 rounded-2xl border shadow-2xl ${bgCard}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold flex items-center space-x-1.5 text-[#E50914]">
              <Sparkles className="w-4 h-4" />
              <span>Auron AI Collection Copilot</span>
            </span>

            <button onClick={() => setAiOpen(false)}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-2 mb-3 text-xs">
            {aiMessages.map((m, i) => (
              <div
                key={i}
                className={`p-2 rounded-xl ${
                  m.sender === 'ai' ? bgSurface : 'bg-[#E50914]/15'
                }`}
              >
                <span className="font-bold">
                  {m.sender === 'ai' ? 'Auron AI: ' : 'You: '}
                </span>
                <span>{m.text}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              'Who has highest overdue?',
              'Check broken promises',
              'Schedule due email reminders',
            ].map((p) => (
              <button
                key={p}
                onClick={() => handleAskAI(p)}
                className={`px-2.5 py-1 rounded-full text-[11px] border hover:border-[#E50914] ${bgSurface}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`rounded-full border shadow-2xl px-4 py-2 flex items-center space-x-2 ${bgCard}`}>
        <button
          onClick={() => setAiOpen(!aiOpen)}
          className="text-[#E50914]"
        >
          <Sparkles className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={aiInput}
          onFocus={() => setAiOpen(true)}
          onChange={(e) => setAiInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
          placeholder="Ask Auron AI about overdue accounts, PTPs, or email reminders..."
          className="flex-1 bg-transparent text-xs focus:outline-none"
        />

        <button
          onClick={() => handleAskAI()}
          className="p-2 rounded-full bg-[#E50914] text-white hover:bg-[#B00020] transition"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}