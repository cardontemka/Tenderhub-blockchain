import "./globals.css";

export const metadata = {
  title: "TenderHub — Тендерийн блокчейн систем",
  description:
    "Тендерийн үйл ажиллагааг блокчейн дээр ил тод, шударга явуулах туршилтын орчин",
};

export default function RootLayout({ children }) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}
