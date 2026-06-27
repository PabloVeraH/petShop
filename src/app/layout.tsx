import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import { Providers } from "@/lib/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "PetShop POS",
  description: "Sistema de punto de venta para pet shops",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <ClerkProvider nonce={nonce} localization={esES}>
      <html lang="es" className={`${inter.variable} h-full antialiased`}>
        <body className="min-h-full bg-gray-50">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
