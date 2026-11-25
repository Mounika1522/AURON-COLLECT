export const getThemeClasses = (darkMode) => ({
  bgCanvas: darkMode
    ? 'bg-[#111111] text-[#F5F5F5]'
    : 'bg-slate-50 text-slate-900',
  bgCard: darkMode
    ? 'bg-[#171717] border-[#292929]'
    : 'bg-white border-slate-200 shadow-sm',
  bgSurface: darkMode
    ? 'bg-[#222222] border-[#333333]'
    : 'bg-slate-100 border-slate-200',
  textMuted: darkMode ? 'text-[#A1A1AA]' : 'text-slate-600',
  borderSubtle: darkMode ? 'border-[#222222]' : 'border-slate-200',
});
