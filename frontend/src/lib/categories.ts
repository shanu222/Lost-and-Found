import type { Category } from './types';

export const CATEGORIES: Category[] = [
  'phone', 'wallet', 'national_id', 'bank_cards', 'documents', 'keys', 'bag', 'jewellery',
  'watch', 'laptop', 'vehicle_documents', 'pets', 'childrens_items', 'cash', 'other',
];

/** Real photos are never public for these (server enforces it too). */
export const PRIVATE_PHOTO: Set<Category> = new Set(['national_id', 'bank_cards', 'documents', 'vehicle_documents', 'cash']);

/** Categories where the finder enters a private identifier. */
export const IDENTIFIER: Partial<Record<Category, 'required' | 'optional'>> = {
  national_id: 'required',
  vehicle_documents: 'required',
  bank_cards: 'optional',
  phone: 'optional',
  laptop: 'optional',
};

/** Number of suggested hidden questions per category (keys questions.<category>.0..n). */
export const SUGGESTION_COUNT = 4;

/** Proof the claimant must give (mirrors backend lib/categories.js). */
export function proofNeeds(c: Category) {
  switch (c) {
    case 'national_id':
    case 'vehicle_documents':
      return { identifier: 'required', selfie: true, contents: false, images: 'optional' } as const;
    case 'bank_cards':
      return { identifier: 'required', selfie: false, contents: true, images: 'optional' } as const;
    case 'phone':
    case 'laptop':
      return { identifier: 'or_images', selfie: false, contents: false, images: 'or_identifier' } as const;
    case 'wallet':
    case 'bag':
      return { identifier: 'none', selfie: false, contents: true, images: 'optional' } as const;
    default:
      return { identifier: 'none', selfie: false, contents: 'or_images', images: 'or_contents' } as const;
  }
}
