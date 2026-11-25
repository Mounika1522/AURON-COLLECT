import React from 'react';

export default function AdminSidebar({
  NAV_ITEMS,
  activeModule,
  setActiveModule,
  currentRole,
  bgCard,
  bgSurface,
  textMuted,
  sidebarColor,
  primaryColor,
  secondaryColor,
}) {
  return (
    <aside
  style={{ backgroundColor: sidebarColor }}
  className={`w-64 border-r hidden lg:flex flex-col justify-between p-3 overflow-y-auto ${bgCard}`}
>
      <div className="space-y-3">

        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-3">
          <img
            src="/auron-logo.png"
            alt="Auron Collect"
            className="w-11 h-11 object-contain"
          />
          <div>
            <h2 className="font-extrabold text-sm tracking-wide">
              AURON COLLECT
            </h2>
            <p
  className="text-[10px] font-semibold"
  style={{ color: secondaryColor }}
>
  by Alpha Auron
</p>
          </div>
        </div>

        {/* Navigation */}
        <div className="space-y-1">
          <p className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 ${textMuted}`}>
            14 Enterprise Modules
          </p>

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;

            return (
             <button
  key={item.id}
  aria-current={active ? 'page' : undefined}
  onClick={() => setActiveModule(item.id)}
  style={{
    backgroundColor: active ? primaryColor : 'transparent',
    boxShadow: active ? `0 4px 12px ${primaryColor}33` : 'none'
  }}
  className={`group w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(229,9,20,0.12)] ${
    active
      ? 'text-white'
      : `${textMuted} hover:bg-[#E50914]/10 hover:text-[#E50914]`
  }`}
>
  <Icon className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-105" />
  <span className="truncate">{item.label}</span>
</button>
            );
          })}
        </div>
      </div>

      {/* Authenticated backend role */}
      <div className={`p-3 rounded-xl border mt-4 ${bgSurface}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold">Account Role</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold">
            Verified by API
          </span>
        </div>
        <p className={`text-xs font-semibold ${textMuted}`}>{currentRole || 'Unknown'}</p>
      </div>
    </aside>
  );
}