import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

// Display face with real character — used for the wordmark, headings and big metric numbers.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

// Clean, neutral UI/body text.
const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Monospace for all data, labels and the uppercase "instrument" eyebrows.
const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ScaleScope — Capacity & Cost Architect",
  description:
    "Describe a system or point at a repo. ScaleScope simulates load, finds the bottleneck and breakpoint, prices it across AWS/GCP/Vercel, and scores production readiness.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const stored = localStorage.getItem("theme");
                  const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                  const theme = stored || system;
                  if (theme === "dark") {
                    document.documentElement.classList.add("dark");
                    document.documentElement.setAttribute("data-theme", "dark");
                  } else {
                    document.documentElement.classList.remove("dark");
                    document.documentElement.setAttribute("data-theme", "light");
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
