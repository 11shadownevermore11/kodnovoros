export interface BusinessUser {
  id: string;
  full_name: string;
  phone_verified: boolean;
  platform_roles: string[];
}

export interface Session {
  access_token: string;
  refresh_token: string;
  requires_totp: boolean;
  totp_enabled: boolean;
  user: BusinessUser;
}

export interface BusinessMeta {
  regions: Record<string, string>;
  listing_types: Record<string, string>;
  listing_statuses: Record<string, string>;
  complaint_statuses: Record<string, string>;
  complaint_reasons: Record<string, string>;
  verification_levels: Record<string, string>;
  org_types: Record<string, string>;
}

export interface Attribute {
  key: string;
  name: string;
  type: "string" | "number" | "enum" | "multi_enum" | "bool" | "range" | "date";
  unit: string | null;
  is_required: boolean;
  is_filterable: boolean;
  options: (string | number | { value: string | number; label?: string })[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  attributes: Attribute[];
  children: Category[];
  allowed_types: string[];
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  type: string;
  region: string;
  verification_level: string;
  verification_label?: string;
  active_listings_count?: number;
  description?: string;
  inn?: string;
  phone?: string;
  plan?: { name: string; max_active_listings: number };
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  category: Pick<Category, "id" | "name" | "slug"> | null;
  organization: Organization | null;
  user: { id: string; full_name: string } | null;
  region: string;
  city: string | null;
  address: string | null;
  type: string;
  price: number | null;
  currency: string;
  price_unit: string | null;
  negotiable: boolean;
  attributes: Record<string, unknown>;
  status: string;
  rejection_reason: string | null;
  contacts_available: boolean;
  contacts: { phone: string | null; telegram: string | null; max_contact: string | null } | null;
  is_favorite: boolean;
  is_top: boolean;
  is_highlight: boolean;
  published_at: string | null;
  expires_at: string | null;
  views_count: number;
}

export interface Page<T> { items: T[]; total: number; page: number; pages: number }
export interface LoginOptions { demo: boolean; telegram: boolean }
export interface TelegramLogin { token: string; login_url: string; expires_in: number }

export class BusinessError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

interface Options {
  method?: string;
  body?: object;
  token?: string;
  signal?: AbortSignal;
}

export async function request<T>(path: string, { method, body, token, signal }: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/v1" + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { ...(body && { "Content-Type": "application/json" }), ...(token && { Authorization: "Bearer " + token }) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new BusinessError("Не удалось связаться с BizBoard. Проверьте подключение.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.details?.errors;
    const suffix = detail ? " · " + Object.values(detail).join(", ") : "";
    throw new BusinessError((data?.error?.message || "Сервис BizBoard временно недоступен") + suffix, response.status, data?.error?.code);
  }
  if (!data) throw new BusinessError("Сервис BizBoard вернул некорректный ответ", response.status);
  return data as T;
}
