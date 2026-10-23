import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agenda Laii | Citas para negocios de belleza",
  description: "Agenda y reservas online para cualquier profesional que trabaja por citas: belleza, consultorios y profesionales independientes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
          Desarrollado por Delarans · 3042357606 · Medellín, Colombia
        </footer>
      </body>
    </html>
  );
}
