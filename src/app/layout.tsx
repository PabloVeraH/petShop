import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "PetShop POS",
  description: "Sistema de punto de venta para pet shops",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="es" className={`${inter.variable} h-full antialiased`}>
        <body className="min-h-full bg-gray-50">{children}</body>
      </html>
    </ClerkProvider>
  );
}
