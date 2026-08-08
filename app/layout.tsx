import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    title: "Vocabulary Box — Every word, never lost",
    description:
      "A quiet, private home for English words and Arabic meanings powered by Google Translate.",
    applicationName: "Vocabulary Box",
    authors: [{ name: "Vocabulary Box" }],
    keywords: ["vocabulary", "English words", "personal dictionary", "Arabic meaning"],
    openGraph: {
      type: "website",
      title: "Vocabulary Box",
      description: "Save English words with Arabic meanings powered by Google Translate.",
      siteName: "Vocabulary Box",
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "Vocabulary Box — Every word. Never lost.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Vocabulary Box",
      description: "Save English words with Arabic meanings powered by Google Translate.",
      images: [socialImage],
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#050806",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
