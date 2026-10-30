import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Imran",
  description: "Imran — connect, chat, and share.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
