import React from 'react';

interface CamarcaLogoProps {
  className?: string;
  height?: number;
  showSubtitle?: boolean;
}

export const CamarcaLogo: React.FC<CamarcaLogoProps> = ({
  className = '',
  height = 54,
  showSubtitle = true,
}) => {
  return (
    <div className={`inline-flex items-center space-x-3.5 select-none ${className}`}>
      {/* High-definition crisp vector emblem */}
      <svg
        viewBox="0 0 200 160"
        style={{ height: `${height}px`, width: 'auto' }}
        className="shrink-0 drop-shadow-sm"
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="geometricPrecision"
        textRendering="geometricPrecision"
      >
        <defs>
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FBBF24" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>

          <linearGradient id="purpleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#581C87" />
            <stop offset="60%" stopColor="#3B0764" />
            <stop offset="100%" stopColor="#1E1B4B" />
          </linearGradient>

          <linearGradient id="cyanAccent" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0284C7" />
          </linearGradient>

          <filter id="crispShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* 3D Isometric Logistics Cube Faces */}
        {/* Left Gold Face */}
        <path
          d="M 15 45 L 100 92 L 100 155 L 15 108 Z"
          fill="url(#goldGradient)"
          stroke="#B45309"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Top Deep Purple Face */}
        <path
          d="M 15 45 L 100 92 L 185 45 L 100 8 Z"
          fill="url(#purpleGradient)"
          stroke="#3B0764"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Right Gradient Shade */}
        <path
          d="M 100 92 L 185 45 L 185 108 L 100 155 Z"
          fill="#1E293B"
          stroke="#0F172A"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Dynamic Courier / Logistics Arrow Ring */}
        <path
          d="M 52 76 A 36 36 0 1 1 144 86"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Arrow Tip */}
        <polygon
          points="136,62 160,78 136,94"
          fill="#FFFFFF"
          stroke="#FFFFFF"
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Precision Clock / Speed Indicators */}
        <circle cx="98" cy="84" r="5" fill="#FBBF24" />
        <line x1="98" y1="84" x2="98" y2="58" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
        <line x1="98" y1="84" x2="122" y2="102" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      </svg>

      {/* Corporate Typography */}
      <div className="flex flex-col justify-center leading-none text-left">
        <div className="flex items-baseline space-x-0.5">
          <span className="text-[26px] font-black tracking-tight text-slate-900 font-sans" style={{ letterSpacing: '-0.03em' }}>
            CAMAR
          </span>
          <span className="text-[26px] font-black tracking-tight text-amber-500 font-sans" style={{ letterSpacing: '-0.03em' }}>
            CA
          </span>
          <span className="text-xs font-black text-slate-500 ml-1 tracking-wider uppercase">
            S.A.S
          </span>
        </div>

        {showSubtitle && (
          <div className="flex items-center space-x-1.5 mt-1">
            <span className="text-[9px] font-extrabold tracking-[0.24em] text-slate-600 uppercase">
              OPERADOR POSTAL & LOGÍSTICA
            </span>
            <span className="text-[8px] font-bold text-amber-600 bg-amber-100 px-1 py-0.2 rounded border border-amber-200">
              4-72
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
