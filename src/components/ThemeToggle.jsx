import React from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ darkMode, setDarkMode, bgSurface = '' }) {
  return (
    <button
      onClick={() => setDarkMode(!darkMode)}
      className={`p-2.5 rounded-xl border transition ${bgSurface}`}
      title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle dark and light theme"
      aria-pressed={darkMode}
    >
      {darkMode ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-gray-700" />
      )}
    </button>
  );
}