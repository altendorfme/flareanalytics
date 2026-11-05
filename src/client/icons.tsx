import { useState } from "react";
import {
  IconArrowRight, IconBrandAndroid, IconBrandApple, IconBrandArc, IconBrandChrome, IconBrandEdge,
  IconBrandFirefox, IconBrandOpera, IconBrandSafari, IconBrandGoogle, IconBrandSamsungpass, IconBrandVivaldi,
  IconBrandWindows, IconDeviceDesktop, IconDeviceMobile, IconDeviceTablet, IconHelpCircle, IconLink, IconMail,
  IconSearch, IconShare, IconSparkles, IconTerminal2, IconWorld, type Icon,
} from "@tabler/icons-react";
import "flag-icons/css/flag-icons.min.css";

const SIZE = 18;
const STROKE = 1.75;

/** Cloudflare RUM names → brand icon. */
const BROWSERS: [RegExp, Icon][] = [
  [/^(Chrome|ChromeMobile|ChromeMobileWebView|Chromium|HeadlessChrome)/i, IconBrandChrome],
  [/^(Safari|MobileSafari|MobileSafariUIWebView)/i, IconBrandSafari],
  [/^Firefox/i, IconBrandFirefox],
  [/^Edge/i, IconBrandEdge],
  [/^Opera/i, IconBrandOpera],
  [/^Vivaldi/i, IconBrandVivaldi],
  [/^Samsung/i, IconBrandSamsungpass],
  [/^Arc/i, IconBrandArc],
];

const OS: [RegExp, Icon][] = [
  [/^Windows/i, IconBrandWindows],
  [/^Android/i, IconBrandAndroid],
  [/^(iOS|iPadOS|MacOSX|macOS|Mac)/i, IconBrandApple],
  [/^(ChromeOS|Chrome OS|CrOS)/i, IconBrandGoogle],
  [/^(Linux|Ubuntu|Debian|Fedora)/i, IconTerminal2],
];

const DEVICES: Record<string, Icon> = { desktop: IconDeviceDesktop, mobile: IconDeviceMobile, tablet: IconDeviceTablet };

export const CHANNEL_ICONS: Record<string, Icon> = {
  direct: IconArrowRight, search: IconSearch, ai: IconSparkles, social: IconShare, email: IconMail, referral: IconLink,
};

function pick(list: [RegExp, Icon][], value: string, fallback: Icon) {
  return list.find(([re]) => re.test(value))?.[1] ?? fallback;
}

const Glyph = ({ icon: I }: { icon: Icon }) => <I size={SIZE} stroke={STROKE} aria-hidden="true" className="flex-none text-ink-2" />;

export const BrowserIcon = ({ name }: { name: string }) => <Glyph icon={pick(BROWSERS, name, IconWorld)} />;
export const OsIcon = ({ name }: { name: string }) => <Glyph icon={pick(OS, name, IconHelpCircle)} />;
export const DeviceIcon = ({ name }: { name: string }) => <Glyph icon={DEVICES[name] ?? IconHelpCircle} />;
export const ChannelIcon = ({ name }: { name: string }) => <Glyph icon={CHANNEL_ICONS[name] ?? IconLink} />;

/** Country flag; unknown countries get a globe. */
export function Flag({ code }: { code: string }) {
  if (!/^[A-Za-z]{2}$/.test(code) || code === "XX" || code === "T1") return <Glyph icon={IconWorld} />;
  return <span className={`fi fi-${code.toLowerCase()} h-[15px] w-5! flex-none rounded-[2px] leading-[15px]! ring-1 ring-border`} aria-hidden="true" />;
}

/** Referrer favicon, globe on failure. */
export function Favicon({ host }: { host: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  return (
    <span className="relative inline-grid size-[18px] flex-none place-items-center" aria-hidden="true">
      <IconWorld size={SIZE} stroke={STROKE} className={`flex-none text-ink-2 transition-opacity duration-120 ${state === "loaded" ? "opacity-0" : ""}`} />
      {state !== "failed" && <img
        src={`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`}
        alt="" width={16} height={16} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-px size-4 rounded-[3px]"
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
      />}
    </span>
  );
}
