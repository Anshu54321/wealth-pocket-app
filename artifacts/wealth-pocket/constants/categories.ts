import type { Feather } from '@expo/vector-icons';

/**
 * Single source of truth for spend / earn / invest category metadata.
 *
 * Screens used to each keep their own icon lookup, which meant a category added
 * to the add-transaction sheet could silently fall through to a generic tag
 * icon. Both the icon mapping and the selectable lists now live here, so a new
 * category gets an icon by construction.
 */

export type CategoryGroup = 'expense' | 'income' | 'investment';

export interface CategoryDefinition {
  readonly name: string;
  readonly icon: keyof typeof Feather.glyphMap;
  /** Words that resolve a free-text label (e.g. from Gmail) to this category. */
  readonly matchers: readonly RegExp[];
}

export const EXPENSE_CATEGORIES: readonly CategoryDefinition[] = [
  { name: 'Food & dining', icon: 'coffee', matchers: [/food|dining|restaurant|cafe|coffee|swiggy|zomato|blinkit|zepto|eat/] },
  { name: 'Groceries', icon: 'shopping-cart', matchers: [/grocer|supermarket|bigbasket|dmart|reliance fresh|kirana/] },
  { name: 'Transport', icon: 'truck', matchers: [/transport|travel|flight|air|rail|train|metro|cab|taxi|ride|fuel|petrol|diesel|parking|toll|irctc/] },
  { name: 'Bills', icon: 'file-text', matchers: [/bill|utility|rent|housing|internet|electric|water|gas|recharge|broadband|wifi|postpaid|prepaid/] },
  { name: 'Shopping', icon: 'shopping-bag', matchers: [/shop|retail|amazon|flipkart|myntra|ajio|clothing|apparel|electronics|mobile/] },
  { name: 'Health', icon: 'heart', matchers: [/health|medical|pharmacy|doctor|hospital|clinic|dental|test|apollo/] },
  { name: 'Entertainment', icon: 'film', matchers: [/entertain|movie|cinema|music|streaming|subscription|concert|game|netflix|hotstar|prime video|spotify/] },
  { name: 'Education', icon: 'book-open', matchers: [/education|course|school|college|tuition|book|fees|university/] },
  { name: 'Subscriptions', icon: 'repeat', matchers: [/subscription|membership|renewal/] },
  { name: 'Gifts', icon: 'gift', matchers: [/gift|donat|charity|offering/] },
  { name: 'Insurance', icon: 'shield', matchers: [/insurance|policy|premium/] },
  { name: 'Cash withdrawal', icon: 'credit-card', matchers: [/atm|cash withdrawal|cash out/] },
  { name: 'Fees', icon: 'percent', matchers: [/fee|charges|commission|penalty/] },
  { name: 'Other', icon: 'tag', matchers: [/other|misc|miscellaneous/] },
];

export const INCOME_CATEGORIES: readonly CategoryDefinition[] = [
  { name: 'Salary', icon: 'briefcase', matchers: [/salary|payroll|wages|pay slip/] },
  { name: 'Business', icon: 'briefcase', matchers: [/business|invoice|b2b|client/] },
  { name: 'Interest', icon: 'percent', matchers: [/interest|fd|recurring deposit/] },
  { name: 'Rental', icon: 'home', matchers: [/rent received|rental|lease/] },
  { name: 'Dividend', icon: 'trending-up', matchers: [/dividend|bonus shares/] },
  { name: 'Refund', icon: 'corner-up-left', matchers: [/refund|reversal|cashback|chargeback/] },
  { name: 'Lending', icon: 'users', matchers: [/lending|loan given|repayment|repaid/] },
  { name: 'Gift received', icon: 'gift', matchers: [/gift received|received gift/] },
  { name: 'Other income', icon: 'tag', matchers: [/other income/] },
];

export const INVESTMENT_CATEGORIES: readonly CategoryDefinition[] = [
  { name: 'Mutual funds', icon: 'trending-up', matchers: [/mutual|sip|fund|hdfc|icici|axis|sbi fund/] },
  { name: 'Stocks', icon: 'bar-chart-2', matchers: [/stock|equity|demat|zerodha|groww|share/] },
  { name: 'Insurance', icon: 'shield', matchers: [/lic|insurance|policy/] },
  { name: 'Fixed deposit', icon: 'lock', matchers: [/fixed deposit|term deposit|fd/] },
  { name: 'Gold', icon: 'award', matchers: [/gold|silver|jewellery|jewelry/] },
  { name: 'Real estate', icon: 'home', matchers: [/property|real estate|plot|land/] },
  { name: 'Emergency fund', icon: 'life-buoy', matchers: [/emergency|savings/] },
  { name: 'Retirement', icon: 'umbrella', matchers: [/retire|pension|provident|epf|nps/] },
  { name: 'Other', icon: 'tag', matchers: [/other investment/] },
];

export const CATEGORY_GROUPS: Record<CategoryGroup, readonly CategoryDefinition[]> = {
  expense: EXPENSE_CATEGORIES,
  income: INCOME_CATEGORIES,
  investment: INVESTMENT_CATEGORIES,
};

export function categoriesFor(group: CategoryGroup): readonly CategoryDefinition[] {
  return CATEGORY_GROUPS[group];
}

export function categoryNames(group: CategoryGroup): string[] {
  return CATEGORY_GROUPS[group].map((category) => category.name);
}

/** Categories shown as one-tap choices during manual review. */
export const REVIEW_CHOICES: readonly string[] = [
  'Food & dining',
  'Groceries',
  'Transport',
  'Bills',
  'Shopping',
  'Health',
  'Entertainment',
  'Education',
  'Other',
];

const ALL_CATEGORIES: readonly CategoryDefinition[] = [
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES,
  ...INVESTMENT_CATEGORIES,
];

/**
 * Resolves a stored category string to an icon.
 *
 * Order matters: exact names win, then longest matching substring, then
 * matcher patterns, and only then the generic tag. Testing matchers only after
 * substring resolution keeps common names such as "Other" stable regardless of
 * what else happens to be in the ledger.
 */
export function categoryIcon(category: string): keyof typeof Feather.glyphMap {
  const label = category.trim();
  if (!label) return 'tag';

  const exact = ALL_CATEGORIES.find(
    (definition) => definition.name.toLowerCase() === label.toLowerCase(),
  );
  if (exact) return exact.icon;

  const lowered = label.toLowerCase();
  const substringMatch = ALL_CATEGORIES
    .filter((definition) => lowered.includes(definition.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (substringMatch) return substringMatch.icon;

  const patternMatch = ALL_CATEGORIES.find((definition) =>
    definition.matchers.some((matcher) => matcher.test(lowered)),
  );
  return patternMatch?.icon ?? 'tag';
}

/** True when a string exactly matches a known category in any group. */
export function isKnownCategory(label: string, group: CategoryGroup): boolean {
  const lowered = label.trim().toLowerCase();
  return CATEGORY_GROUPS[group].some(
    (definition) => definition.name.toLowerCase() === lowered,
  );
}