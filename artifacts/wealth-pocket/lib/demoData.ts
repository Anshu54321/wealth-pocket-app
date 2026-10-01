import type { AppNotificationKind } from './database';

/**
 * Deterministic sample dataset for previewing every screen and animation.
 *
 * This is development scaffolding, not a migration: nothing here runs on app
 * start. The user loads it explicitly from Settings > Demo data, which makes it
 * obvious that an empty-looking screen is the real initial state.
 *
 * All amounts are minor units (paise) and all timestamps are derived from a
 * caller-supplied `now`, so seeding twice on the same day produces the same
 * relative history rather than a moving target.
 */

/** Mulberry32: small, fast, and reproducible. Good enough for sample data. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export interface DemoTransaction {
  amountMinor: number;
  merchant: string;
  category: string;
  kind: 'expense' | 'income' | 'investment';
  occurredAt: number;
  source: 'manual' | 'gmail';
  investmentBucket?: string;
  provider?: string;
}

export interface DemoDebt {
  borrower: string;
  phone: string;
  principalMinor: number;
  repaidMinor: number;
  interestRate: number;
  givenAt: number;
  dueAt: number;
  status: 'active' | 'settled';
}

export interface DemoNotification {
  kind: AppNotificationKind;
  title: string;
  body: string;
  action: string | null;
  /** Hours before `now`; keeps the Today / Earlier split populated. */
  hoursAgo: number;
  read: boolean;
}

export interface DemoDataset {
  transactions: DemoTransaction[];
  debts: DemoDebt[];
  notifications: DemoNotification[];
}

/** Recurring salary, with one mid-year raise so the cash-flow chart has a kink. */
const MONTHLY_SALARY: readonly number[] = [185_000, 185_000, 192_000, 192_000, 192_000, 205_000];

/**
 * Daily spend templates. `weight` biases how often a line item appears, and
 * `spread` scales the jitter so essentials stay put while discretionary spend
 * varies month to month.
 */
interface SpendTemplate {
  merchant: string;
  category: string;
  lowMinor: number;
  highMinor: number;
  /** Rough probability of appearing on a given day, 0-1. */
  chance: number;
}

const DAILY_SPEND: readonly SpendTemplate[] = [
  { merchant: 'Swiggy', category: 'Food & dining', lowMinor: 28_000, highMinor: 74_000, chance: 0.62 },
  { merchant: 'Zomato', category: 'Food & dining', lowMinor: 24_000, highMinor: 68_000, chance: 0.4 },
  { merchant: 'Third Wave Coffee', category: 'Food & dining', lowMinor: 18_000, highMinor: 42_000, chance: 0.18 },
  { merchant: 'BigBasket', category: 'Groceries', lowMinor: 180_000, highMinor: 640_000, chance: 0.16 },
  { merchant: 'Blinkit', category: 'Groceries', lowMinor: 24_000, highMinor: 96_000, chance: 0.3 },
  { merchant: 'Uber', category: 'Transport', lowMinor: 12_000, highMinor: 52_000, chance: 0.34 },
  { merchant: 'Indian Oil', category: 'Transport', lowMinor: 200_000, highMinor: 400_000, chance: 0.12 },
  { merchant: 'IRCTC', category: 'Transport', lowMinor: 90_000, highMinor: 340_000, chance: 0.03 },
  { merchant: 'Apollo Pharmacy', category: 'Health', lowMinor: 18_000, highMinor: 145_000, chance: 0.1 },
  { merchant: 'Amazon', category: 'Shopping', lowMinor: 45_000, highMinor: 380_000, chance: 0.14 },
  { merchant: 'Myntra', category: 'Shopping', lowMinor: 79_000, highMinor: 420_000, chance: 0.06 },
  { merchant: 'Netflix', category: 'Subscriptions', lowMinor: 64_900, highMinor: 64_900, chance: 0.02 },
  { merchant: 'Spotify', category: 'Subscriptions', lowMinor: 11_900, highMinor: 11_900, chance: 0.02 },
  { merchant: 'PVR Cinemas', category: 'Entertainment', lowMinor: 55_000, highMinor: 120_000, chance: 0.04 },
  { merchant: 'Coursera', category: 'Education', lowMinor: 39_900, highMinor: 89_900, chance: 0.02 },
  { merchant: 'ATM Withdrawal', category: 'Cash withdrawal', lowMinor: 200_000, highMinor: 500_000, chance: 0.05 },
];

/** Monthly fixed commitments, charged on a stable day each month. */
const MONTHLY_BILLS: readonly (SpendTemplate & { dayOfMonth: number })[] = [
  { merchant: 'Airtel Fiber', category: 'Bills', lowMinor: 119_900, highMinor: 119_900, chance: 1, dayOfMonth: 4 },
  { merchant: 'Maha Electricity', category: 'Bills', lowMinor: 145_000, highMinor: 420_000, chance: 1, dayOfMonth: 8 },
  { merchant: 'House Rent', category: 'Bills', lowMinor: 320_000, highMinor: 320_000, chance: 1, dayOfMonth: 1 },
  { merchant: 'Star Health', category: 'Insurance', lowMinor: 186_000, highMinor: 186_000, chance: 1, dayOfMonth: 12 },
  { merchant: 'Airtel Postpaid', category: 'Bills', lowMinor: 79_900, highMinor: 94_900, chance: 1, dayOfMonth: 15 },
];

/**
 * Monthly investment buckets. `monthIndex` gates the newer buckets to later
 * months so the portfolio grows across the visible history.
 */
interface InvestmentTemplate extends SpendTemplate {
  monthIndex: number;
  provider: string;
}

const MONTHLY_INVESTMENTS: readonly InvestmentTemplate[] = [
  { merchant: 'HDFC Flexi Cap SIP', category: 'Mutual funds', lowMinor: 50_000, highMinor: 50_000, chance: 1, monthIndex: 0, provider: 'Groww' },
  { merchant: 'Nifty 50 Index', category: 'Stocks', lowMinor: 40_000, highMinor: 40_000, chance: 1, monthIndex: 0, provider: 'Zerodha' },
  { merchant: 'ICICI Liquid Fund', category: 'Emergency fund', lowMinor: 75_000, highMinor: 75_000, chance: 1, monthIndex: 1, provider: 'Groww' },
  { merchant: 'LIC Tax Saver', category: 'Insurance', lowMinor: 100_000, highMinor: 100_000, chance: 1, monthIndex: 1, provider: 'LIC' },
  { merchant: 'Gold Bond', category: 'Gold', lowMinor: 60_000, highMinor: 60_000, chance: 1, monthIndex: 3, provider: 'NSE' },
  { merchant: 'NPS Tier-1', category: 'Retirement', lowMinor: 50_000, highMinor: 50_000, chance: 1, monthIndex: 4, provider: 'eNPS' },
];

/** Occasional inflows so the income chart is not a single flat salary line. */
const VARIABLE_INCOME: readonly (SpendTemplate & { chance: number })[] = [
  { merchant: 'Zerodha Dividend', category: 'Dividend', lowMinor: 8_000, highMinor: 46_000, chance: 0.5 },
  { merchant: 'HDFC FD Interest', category: 'Interest', lowMinor: 4_200, highMinor: 9_800, chance: 0.6 },
  { merchant: 'Freelance Invoice', category: 'Business', lowMinor: 25_000, highMinor: 120_000, chance: 0.35 },
  { merchant: 'Amazon Refund', category: 'Refund', lowMinor: 8_000, highMinor: 45_000, chance: 0.25 },
];

/**
 * A few uncategorised Gmail rows so the review queue and Alerts have content.
 * Merchant strings are deliberately opaque, which is what a real bank alert
 * looks like once it hits the parser.
 */
const NEEDS_REVIEW: readonly { merchant: string; lowMinor: number; highMinor: number }[] = [
  { merchant: 'PAYMENT TO 4821XX9930', lowMinor: 45_000, highMinor: 210_000 },
  { merchant: 'UPI/CRDR/ANONYMOUS PAYER', lowMinor: 20_000, highMinor: 95_000 },
  { merchant: 'NEFT IMPS IN 0912', lowMinor: 90_000, highMinor: 340_000 },
];

function jitter(random: () => number, low: number, high: number): number {
  return Math.round(low + random() * (high - low));
}

/**
 * Builds the sample dataset spanning `months` back from `now`.
 *
 * `now` is injected rather than read from `Date.now()` internally so callers
 * (and tests) control the anchor.
 */
export function buildDemoDataset(now: number = Date.now(), months = 6): DemoDataset {
  // Fixed seed so re-seeding gives the same ledger; a sample dataset that
  // reshuffles on every tap is annoying to compare against a screenshot.
  const random = createRandom(0x5eed_1a7e);
  const transactions: DemoTransaction[] = [];
  const anchor = new Date(now);
  anchor.setHours(12, 0, 0, 0);
  const anchorMs = anchor.getTime();

  // Walk back whole calendar months so each month holds a full salary cycle and
  // the cash-flow chart gets six populated columns rather than six partial ones.
  for (let monthIndex = months - 1; monthIndex >= 0; monthIndex -= 1) {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth() - monthIndex, 1);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const monthsAgo = months - 1 - monthIndex;
    const salary = MONTHLY_SALARY[Math.min(monthsAgo, MONTHLY_SALARY.length - 1)];

    // Salary on the 28th, jittered by an hour so the list ordering varies.
    transactions.push({
      amountMinor: salary,
      merchant: 'Acme Corp Payroll',
      category: 'Salary',
      kind: 'income',
      occurredAt: new Date(monthStart.getFullYear(), monthStart.getMonth(), 28, 10, jitter(random, 0, 59)).getTime(),
      source: 'gmail',
    });

    for (const bill of MONTHLY_BILLS) {
      const day = Math.min(bill.dayOfMonth, daysInMonth);
      transactions.push({
        amountMinor: jitter(random, bill.lowMinor, bill.highMinor),
        merchant: bill.merchant,
        category: bill.category,
        kind: 'expense',
        occurredAt: new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 9, jitter(random, 0, 59)).getTime(),
        source: 'manual',
      });
    }

    for (const investment of MONTHLY_INVESTMENTS) {
      if (investment.monthIndex > monthsAgo) continue;
      transactions.push({
        amountMinor: jitter(random, investment.lowMinor, investment.highMinor),
        merchant: investment.merchant,
        category: investment.category,
        kind: 'investment',
        occurredAt: new Date(monthStart.getFullYear(), monthStart.getMonth(), 5, 11, jitter(random, 0, 59)).getTime(),
        source: 'manual',
        investmentBucket: investment.category,
        provider: investment.provider,
      });
    }

    for (const inflow of VARIABLE_INCOME) {
      if (random() > inflow.chance) continue;
      transactions.push({
        amountMinor: jitter(random, inflow.lowMinor, inflow.highMinor),
        merchant: inflow.merchant,
        category: inflow.category,
        kind: 'income',
        occurredAt: new Date(monthStart.getFullYear(), monthStart.getMonth(), 2 + Math.floor(random() * 26), 14, jitter(random, 0, 59)).getTime(),
        source: 'gmail',
      });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 8, 30);
      // Skip days past today so history never contains a future transaction.
      if (dayStart.getTime() > anchorMs) break;
      for (const spend of DAILY_SPEND) {
        if (random() > spend.chance) continue;
        transactions.push({
          amountMinor: jitter(random, spend.lowMinor, spend.highMinor),
          merchant: spend.merchant,
          category: spend.category,
          kind: 'expense',
          occurredAt: dayStart.getTime() + jitter(random, 0, 10) * 60 * MINUTE,
          source: random() > 0.35 ? 'gmail' : 'manual',
        });
      }
    }
  }

  for (const review of NEEDS_REVIEW) {
    transactions.push({
      amountMinor: jitter(random, review.lowMinor, review.highMinor),
      merchant: review.merchant,
      category: 'Needs review',
      kind: 'expense',
      occurredAt: anchorMs - jitter(random, 1, 40) * DAY,
      source: 'gmail',
    });
  }

  transactions.sort((a, b) => b.occurredAt - a.occurredAt);

  const debts: DemoDebt[] = [
    {
      borrower: 'Rohit Sharma',
      phone: '+91 98111 20304',
      principalMinor: 500_000,
      repaidMinor: 200_000,
      interestRate: 0,
      givenAt: anchorMs - 4 * DAY,
      dueAt: anchorMs + 9 * DAY,
      status: 'active',
    },
    {
      borrower: 'Priya Nair',
      phone: '+91 99203 77415',
      principalMinor: 1_200_000,
      repaidMinor: 450_000,
      interestRate: 1.5,
      givenAt: anchorMs - 42 * DAY,
      dueAt: anchorMs + 2 * DAY,
      status: 'active',
    },
    {
      borrower: 'Vikram Iyer',
      phone: '+91 90040 55122',
      principalMinor: 300_000,
      repaidMinor: 150_000,
      interestRate: 0,
      givenAt: anchorMs - 96 * DAY,
      dueAt: anchorMs - 12 * DAY,
      status: 'active',
    },
    {
      borrower: 'Ananya Gupta',
      phone: '+91 98867 41093',
      principalMinor: 750_000,
      repaidMinor: 750_000,
      interestRate: 0,
      givenAt: anchorMs - 220 * DAY,
      dueAt: anchorMs - 40 * DAY,
      status: 'settled',
    },
  ];

  const notifications: DemoNotification[] = [
    {
      kind: 'lending',
      title: 'Priya Nair is due in 2 days',
      body: '₹7,500 outstanding on a ₹12,000 loan. A reminder is queued for tomorrow morning.',
      action: '/(tabs)/lending',
      hoursAgo: 3,
      read: false,
    },
    {
      kind: 'review',
      title: '3 transactions need a category',
      body: 'Imported from Gmail but Mira could not match the merchant. Tap to pick one.',
      action: null,
      hoursAgo: 7,
      read: false,
    },
    {
      kind: 'sync',
      title: 'Gmail import finished',
      body: '24 new transactions were added from your inbox for the last 7 days.',
      action: '/(tabs)/index',
      hoursAgo: 9,
      read: false,
    },
    {
      kind: 'reminder',
      title: 'Vikram Iyer has not repaid yet',
      body: '₹1,500 of ₹3,000 was due 12 days ago. Consider sending a follow-up.',
      action: '/(tabs)/lending',
      hoursAgo: 26,
      read: true,
    },
    {
      kind: 'system',
      title: 'Monthly wrap-up is ready',
      body: 'You spent 12% less than last month and your savings rate reached 34%.',
      action: '/(tabs)/insights',
      hoursAgo: 50,
      read: true,
    },
    {
      kind: 'system',
      title: 'Database encrypted',
      body: 'Your ledger is protected with SQLCipher. The key is stored in the device keystore.',
      action: null,
      hoursAgo: 74,
      read: true,
    },
  ];

  return { transactions, debts, notifications };
}
