export const STATUS = ["Draft", "Awaiting", "Active", "Completed", "Cancelled"];
export const STATUS_MN = [
  "Ноорог",
  "Гүйцэтгэгч хүлээж буй",
  "Идэвхтэй",
  "Дууссан",
  "Цуцлагдсан",
];
export const TRANCHE_KIND = ["Урьдчилгаа", "Шатлал", "Арбитрын хөлс"];
export const LOAN_STATE = [
  "None",
  "Хүсэлт илгээсэн",
  "Санал ирсэн",
  "Гүйцэтгэгч зөвшөөрсөн",
  "Барьцаа шилжсэн",
  "Зээл олгосон",
  "Эргэн төлсөн",
  "Хаагдсан",
  "Татгалзсан",
];
export const DISPUTE_STATE = [
  "None",
  "Нээлттэй",
  "Шийдвэр гарсан",
  "Шийдэгдсэн",
  "Давж заалдсан",
];
export const ROLE = ["—", "Захиалагч", "Гүйцэтгэгч", "Арбитр"];

export function short(addr) {
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function tugrug(n) {
  try {
    return new Intl.NumberFormat("mn-MN").format(BigInt(n)) + " ₮";
  } catch {
    return String(n) + " ₮";
  }
}

export function ts(seconds) {
  const s = Number(seconds);
  if (!s) return "—";
  return new Date(s * 1000).toLocaleString("mn-MN");
}
