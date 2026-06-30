export const STATUS_MN = [
  "Ноорог",
  "Гүйцэтгэгч хүлээж буй",
  "Идэвхтэй",
  "Түр зогссон (Suspended)",
  "Цуцлагдсан",
  "Дууссан",
];
export const TRANCHE_KIND = ["Шатлал", "Барьцаа", "Арбитрын хөлс", "Алданги/Торгууль", "Урьдчилгаа"];
export const LOAN_STATE = [
  "None",
  "Хүсэлт илгээсэн",
  "Санал ирсэн",
  "Гүйцэтгэгч зөвшөөрсөн",
  "Барьцаа шилжсэн (дууссан)",
  "Татгалзсан",
];
export const DISPUTE_STATE = ["None", "Нээлттэй", "Шийдвэр гарсан", "Шийдэгдсэн", "Давж заалдсан"];
export const AMEND_STATE = ["—", "Төлөвлөсөн (Staged)", "Татгалзсан"];
export const SUBJECT = ["—", "Ажил хүлээлгэх", "Гэрээний өөрчлөлт", "Гэрээг цуцлах"];
export const ROLE = ["—", "Захиалагч", "Гүйцэтгэгч", "Арбитр"];

const ZERO = "0x0000000000000000000000000000000000000000";

export function short(addr) {
  if (!addr || addr === ZERO) return "—";
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

// Days/HH:MM:SS countdown. Pass refMs to freeze it at a fixed reference time
// (used while the contract is paused/frozen so the clock stops visibly).
export function countdown(deadlineSec, refMs) {
  const dl = Number(deadlineSec);
  if (!dl) return { text: "—", overdue: false, days: 0 };
  const now = Math.floor((refMs ?? Date.now()) / 1000);
  let diff = dl - now;
  const overdue = diff < 0;
  diff = Math.abs(diff);
  const d = Math.floor(diff / 86400);
  const hh = Math.floor((diff % 86400) / 3600);
  const mm = Math.floor((diff % 3600) / 60);
  const text = `${d} хоног ${hh.toString().padStart(2, "0")}:${mm
    .toString()
    .padStart(2, "0")}`;
  return { text: overdue ? `${text} хэтэрсэн` : `${text} үлдсэн`, overdue, days: d };
}
