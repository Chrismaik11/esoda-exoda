/* engine.js — μηχανή κατανομής (ίδια μαθηματικά με το engine.js της ρίζας/Functions) */
import { fmtD, parseD, addDays, daysInMonth, daysInYear, daysInQuarter, GR_MONTHS } from "./util.js";

export function dailyAccrual(cost, dateStr) {
  const d = parseD(dateStr);
  if (cost.startDate && d < parseD(cost.startDate)) return 0;
  if (cost.endDate && d > parseD(cost.endDate)) return 0;
  const y = d.getFullYear(), m = d.getMonth();
  switch (cost.period) {
    case "weekly": return cost.amount / 7;
    case "monthly": return cost.amount / daysInMonth(y, m);
    case "quarterly": return cost.amount / daysInQuarter(y, m);
    case "yearly": return cost.amount / daysInYear(y);
    default: return 0;
  }
}

export function computePnL(data, fromStr, toStr) {
  const from = parseD(fromStr), to = parseD(toStr);
  let revenue = 0, purchases = 0, misc = 0, fixed = 0, payroll = 0;
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const ds = fmtD(d);
    revenue += data.revenues[ds] || 0;
    for (const c of data.recurring) {
      const a = dailyAccrual(c, ds);
      if (c.category === "payroll") payroll += a; else fixed += a;
    }
  }
  for (const e of data.expenses) {
    const d = parseD(e.date);
    if (d >= from && d <= to) {
      if (e.type === "purchase") purchases += e.amount; else misc += e.amount;
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    revenue: round(revenue), purchases: round(purchases), misc: round(misc),
    fixed: round(fixed), payroll: round(payroll),
    profit: round(revenue - purchases - misc - fixed - payroll)
  };
}

export function periodRange(g, anchorStr) {
  const a = parseD(anchorStr);
  if (g === "day") return [anchorStr, anchorStr, anchorStr];
  if (g === "week") {
    const off = (a.getDay() + 6) % 7;
    const mon = addDays(a, -off), sun = addDays(mon, 6);
    return [fmtD(mon), fmtD(sun), `${fmtD(mon)} – ${fmtD(sun)}`];
  }
  if (g === "month") {
    const y = a.getFullYear(), m = a.getMonth();
    return [fmtD(new Date(y, m, 1)), fmtD(new Date(y, m, daysInMonth(y, m))), `${GR_MONTHS[m]} ${y}`];
  }
  const y = a.getFullYear();
  return [fmtD(new Date(y, 0, 1)), fmtD(new Date(y, 11, 31)), `Έτος ${y}`];
}
