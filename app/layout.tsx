import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

// Inter, IBM Plex Sans Arabic and IBM Plex Mono are self-hosted and declared in
// app/fonts.css — see the note there for why `next/font` is not used.

/**
 * Applies the stored language to <html> before first paint so the page never
 * flashes the wrong text direction. The site has a single fixed light theme,
 * so there is nothing to bootstrap for colour scheme.
 */
const BOOTSTRAP_SCRIPT = `(function(){try{
var e=document.documentElement;
var l=localStorage.getItem("ebara:locale")==="ar"?"ar":"en";
e.setAttribute("lang",l);
e.setAttribute("dir",l==="ar"?"rtl":"ltr");
}catch(_){}})();`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" ? "http" : "https";
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    requestHeaders.get("host") ??
    "localhost:3000";

  let socialImage = "https://localhost:3000/og.png";
  try {
    socialImage = new URL("/og.png", `${protocol}://${host}`).toString();
  } catch {
    // The fallback remains a valid absolute URL for non-browser render probes.
  }

  return {
    title: "EBARA — Every word, never lost",
    description:
      "A quiet, private home for English words, dictionary details, and Arabic meanings.",
    applicationName: "EBARA",
    authors: [{ name: "EBARA" }],
    keywords: ["vocabulary", "English words", "personal dictionary", "Arabic meaning"],
    manifest: "/manifest.webmanifest",
    openGraph: {
      type: "website",
      title: "EBARA",
      description: "Save English words with definitions and Arabic meanings.",
      siteName: "EBARA",
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "EBARA — Every word. Never lost.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "EBARA",
      description: "Save English words with definitions and Arabic meanings.",
      images: [socialImage],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/favicon.svg",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
