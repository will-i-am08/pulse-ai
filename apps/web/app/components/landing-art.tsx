/* Decorative SVG art for the landing page — doodles + section icons.
   Pure presentational JSX; safe to render from server components.
   Styling (stroke/fill) comes from page.module.css via the passed className. */
import type { ReactElement } from 'react';

type DoodleProps = { className?: string };

/* ── hand-drawn doodles ──────────────────────────── */
export function Underline({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 200 16" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d="M10 9c20-5 40 5 60 0s40-5 60 0 40 5 60 0" />
    </svg>
  );
}

export function Ticks({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 64 48" aria-hidden="true">
      <path d="M8 28l10 10 20-24" />
      <path d="M40 34c6-2 12-2 18 2" style={{ strokeDasharray: '1.2 4', strokeWidth: 1.4 }} />
    </svg>
  );
}

export function ArrowYes({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 92 78" aria-hidden="true">
      <path d="M12 12c18 6 38 28 48 48" />
      <path d="M52 52l10 10 2-14" style={{ strokeDasharray: 'none', strokeWidth: 1.7 }} />
      <path d="M52 52l14 2" style={{ strokeDasharray: 'none', strokeWidth: 1.7 }} />
    </svg>
  );
}

export function Loop({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 120 70" aria-hidden="true">
      <path d="M18 42c8-22 42-28 58-12s6 36-16 40c-18 4-34-10-30-24 3-12 18-16 28-10" />
    </svg>
  );
}

export function Save({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 78 54" aria-hidden="true">
      <path d="M8 40c14-4 28-22 42-28" />
      <path d="M42 8l10 6-12 4" style={{ strokeDasharray: 'none', strokeWidth: 1.7 }} />
      <circle cx="14" cy="44" r="3" style={{ strokeDasharray: '1 3', strokeWidth: 1.3 }} />
    </svg>
  );
}

export function Cta({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 70 58" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d="M52 8c-2 12-10 24-28 34" />
      <path style={{ strokeDasharray: 'none', strokeWidth: 1.7 }} d="M18 34l8 10 12-6" />
    </svg>
  );
}

/* ── who / about line icons ──────────────────────── */
export function ShopIcon(): ReactElement {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path d="M18 38l8-18h44l8 18" />
      <path d="M22 38v34h52V38" />
      <path d="M38 72V52h20v20" />
      <circle cx="30" cy="46" r="2.2" className="inkFill" />
      <circle cx="66" cy="46" r="2.2" className="inkFill" />
    </svg>
  );
}

export function CreatorIcon(): ReactElement {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <rect x="22" y="18" width="52" height="60" rx="8" />
      <circle cx="48" cy="42" r="12" />
      <path d="M32 68c4-8 12-12 16-12s12 4 16 12" />
      <path d="M58 22l8-6 4 8" />
      <path d="M66 20l4 2" />
    </svg>
  );
}

export function FounderIcon(): ReactElement {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path d="M28 70V40l20-14 20 14v30" />
      <path d="M40 70V52h16v18" />
      <path d="M20 70h56" />
      <path d="M48 26v-6" />
      <circle cx="48" cy="16" r="3" />
    </svg>
  );
}

/* ── job-strip micro icons ───────────────────────── */
export function CaptionIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h10M5 17h12" />
    </svg>
  );
}
export function CalendarIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  );
}
export function NudgeIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v2M12 18v2M6 12H4M20 12h-2" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 9v3l2 2" />
    </svg>
  );
}
export function RecapIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8h10M7 12h7M7 16h9" />
      <path d="M5 5h14v14H5z" />
    </svg>
  );
}
export function YesIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l5 5L19 7" />
    </svg>
  );
}
export function AutopilotIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

/* ── channel brand glyphs (filled) ───────────────── */
export function IgIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077" />
    </svg>
  );
}
export function FbIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  );
}
export function XIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}
export function ThreadsIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z" />
    </svg>
  );
}

/* ── trust icons ─────────────────────────────────── */
export function LockIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="12" y="22" width="24" height="18" rx="3" />
      <path d="M18 22v-6a6 6 0 0 1 12 0v6" />
      <circle cx="24" cy="31" r="2" className="inkFill" />
    </svg>
  );
}
export function ControlIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="14" />
      <circle cx="24" cy="24" r="4" />
      <path d="M24 10v4M24 34v4M10 24h4M34 24h4" />
    </svg>
  );
}
export function VisibleIcon({ className }: DoodleProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M6 24s8-12 18-12 18 12 18 12-8 12-18 12S6 24 6 24z" />
      <circle cx="24" cy="24" r="5" />
    </svg>
  );
}
