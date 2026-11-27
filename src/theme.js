export const getThemeClasses = (darkMode) => ({
  bgCanvas: darkMode
    ? 'bg-[#0B1220] text-[#F3F6FB]'
    : 'bg-[#F4F7FB] text-slate-900',
  bgCard: darkMode
    ? 'bg-[#111C2E] border-[#28364B]'
    : 'bg-white border-[#DFE6EF] shadow-sm',
  bgSurface: darkMode
    ? 'bg-[#18263B] border-[#33445D]'
    : 'bg-[#EEF2F7] border-[#DCE3ED]',
  textMuted: darkMode ? 'text-[#A7B3C5]' : 'text-slate-600',
  borderSubtle: darkMode ? 'border-[#28364B]' : 'border-[#DFE6EF]',
});
