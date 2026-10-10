import type { Member, State } from "./model.js";
import {
  accountCustomer,
  customerNotices,
  noticeCategory,
} from "./clientAccount.js";
import { clientMaintenance } from "./clientMaintenance.js";

export function clientNews(s: State, member: Member, now: string) {
  if (!accountCustomer(s, member)) return { maintenance: [], messages: [] };
  return {
    maintenance: clientMaintenance(s, member, now).items.filter(
      (i) => !["done", "unknown"].includes(i.level),
    ),
    // Maintenance is derived from current goals, so resolved/old notices are not
    // duplicated as active news. Operational decisions remain in the visit card.
    messages: customerNotices(s, member).filter(
      (n) => noticeCategory(n) === "messages" && !n.newsHiddenAt,
    ),
  };
}
