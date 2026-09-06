export interface PublicMenuOption {
  id: string;
  name: string;
  priceDeltaCents: number;
  currency: string;
}

export interface PublicMenuOptionGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: PublicMenuOption[];
}

export interface PublicMenuVariant {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

export interface PublicMenuDish {
  id: string;
  name: string;
  description: string;
  priceCents: number | null;
  currency: string;
  soldOut: boolean;
  image: { path: string; alt: string } | null;
  variants: PublicMenuVariant[];
  optionGroups: PublicMenuOptionGroup[];
  labels: string[];
  allergenNotice: string;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  dishes: PublicMenuDish[];
}

export interface PublicMenu {
  tenant: {
    slug: string;
    name: string;
    description: string;
    timezone: string;
    brandColor: string;
  };
  categories: PublicMenuCategory[];
}

export type PublicLegalPageKind = "imprint" | "privacy" | "terms";

export interface PublicLegalPage {
  tenantName: string;
  text: string;
}
