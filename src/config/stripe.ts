type BillingMode = 'byo' | 'hosted_lite' | 'hosted_plan' | 'credit_pack';
type BillingInterval = 'month' | 'one_time';

export type StripeCatalogItem = {
    id: string;
    name: string;
    price: number;
    priceId: string;
    interval: BillingInterval;
    mode: BillingMode;
    includedCreditsCents: number;
};

const fallbackEnv = (key: string, fallback: string) => {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
        return process.env[key] as string;
    }
    return fallback;
};

export const STRIPE_PLANS = {
    LITE: {
        id: 'lite',
        name: 'Lite',
        priceId: fallbackEnv('STRIPE_PRICE_LITE', 'price_lite_placeholder'),
        price: 0.99,
        interval: 'month',
        mode: 'hosted_lite',
        includedCreditsCents: 0,
    },
    STARTER: {
        id: 'starter',
        name: 'Starter',
        priceId: fallbackEnv('STRIPE_PRICE_STARTER', 'price_starter_placeholder'),
        price: 9,
        interval: 'month',
        mode: 'hosted_plan',
        includedCreditsCents: 800,
    },
    PRO: {
        id: 'pro',
        name: 'Pro',
        priceId: fallbackEnv('STRIPE_PRICE_PRO', 'price_pro_placeholder'),
        price: 29,
        interval: 'month',
        mode: 'hosted_plan',
        includedCreditsCents: 2800,
    },
    STUDIO: {
        id: 'studio',
        name: 'Studio',
        priceId: fallbackEnv('STRIPE_PRICE_STUDIO', 'price_studio_placeholder'),
        price: 79,
        interval: 'month',
        mode: 'hosted_plan',
        includedCreditsCents: 8000,
    },
    BYOK: {
        id: 'byo',
        name: 'Bring Your Own Keys',
        priceId: fallbackEnv('STRIPE_PRICE_BYOK', 'price_byok_placeholder'),
        price: 29,
        interval: 'one_time',
        mode: 'byo',
        includedCreditsCents: 0,
    },
} as const satisfies Record<string, StripeCatalogItem>;

export const CREDIT_PACKAGES = {
    CREDITS_1000: {
        id: 'credits-1000',
        name: '10 Credits',
        price: 10,
        priceId: fallbackEnv('STRIPE_PRICE_CREDITS_1000', 'price_credits_1000'),
        interval: 'one_time',
        mode: 'credit_pack',
        includedCreditsCents: 1000,
    },
    CREDITS_2500: {
        id: 'credits-2500',
        name: '25 Credits',
        price: 25,
        priceId: fallbackEnv('STRIPE_PRICE_CREDITS_2500', 'price_credits_2500'),
        interval: 'one_time',
        mode: 'credit_pack',
        includedCreditsCents: 2500,
    },
    CREDITS_5000: {
        id: 'credits-5000',
        name: '50 Credits',
        price: 50,
        priceId: fallbackEnv('STRIPE_PRICE_CREDITS_5000', 'price_credits_5000'),
        interval: 'one_time',
        mode: 'credit_pack',
        includedCreditsCents: 5000,
    },
    CREDITS_10000: {
        id: 'credits-10000',
        name: '100 Credits',
        price: 100,
        priceId: fallbackEnv('STRIPE_PRICE_CREDITS_10000', 'price_credits_10000'),
        interval: 'one_time',
        mode: 'credit_pack',
        includedCreditsCents: 10000,
    },
} as const satisfies Record<string, StripeCatalogItem>;

export type PlanType = keyof typeof STRIPE_PLANS;
export type CreditPackageType = keyof typeof CREDIT_PACKAGES;
export type BillingPlanKey =
    | (typeof STRIPE_PLANS)[PlanType]['id']
    | (typeof CREDIT_PACKAGES)[CreditPackageType]['id'];

const CATALOG: StripeCatalogItem[] = [
    ...Object.values(STRIPE_PLANS),
    ...Object.values(CREDIT_PACKAGES),
];

const CATALOG_BY_ID = new Map<string, StripeCatalogItem>(
    CATALOG.map((item) => [item.id, item]),
);

const CATALOG_BY_PRICE_ID = new Map<string, StripeCatalogItem>(
    CATALOG.filter((item) => item.priceId).map((item) => [item.priceId, item]),
);

export const getCatalogItemById = (id?: string | null): StripeCatalogItem | undefined => {
    if (!id) return undefined;
    return CATALOG_BY_ID.get(id);
};

export const getCatalogItemByPriceId = (priceId?: string | null): StripeCatalogItem | undefined => {
    if (!priceId) return undefined;
    return CATALOG_BY_PRICE_ID.get(priceId);
};

export const getPlanByPriceId = (priceId: string) => {
    return getCatalogItemByPriceId(priceId);
};

export const getPriceIdForKey = (idOrPriceId: string): string | null => {
    if (!idOrPriceId) return null;
    if (idOrPriceId.startsWith('price_')) return idOrPriceId;
    const item = getCatalogItemById(idOrPriceId);
    if (!item?.priceId) return null;
    if (!item.priceId.startsWith('price_')) return null;
    return item.priceId;
};

export const isCreditPackId = (id?: string | null): boolean => {
    const item = getCatalogItemById(id || '');
    return item?.mode === 'credit_pack';
};
