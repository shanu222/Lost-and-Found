// Item categories and the rules attached to them.
export const CATEGORIES = [
  'phone', 'wallet', 'national_id', 'bank_cards', 'documents', 'keys', 'bag', 'jewellery',
  'watch', 'laptop', 'vehicle_documents', 'pets', 'childrens_items', 'cash', 'other',
];

/** Real photos are NEVER public for these — an illustration is shown instead. */
export const PRIVATE_PHOTO_CATEGORIES = new Set(['national_id', 'bank_cards', 'documents', 'vehicle_documents', 'cash']);

/** Categories where the finder should enter a private identifier (ID number / serial / IMEI). */
export const IDENTIFIER_CATEGORIES = new Set(['national_id', 'bank_cards', 'vehicle_documents', 'phone', 'laptop']);

/** Proof a claimant must provide, per category. */
export function proofRequirements(category) {
  switch (category) {
    case 'national_id':
    case 'vehicle_documents':
      return { idNumber: true, selfie: true, images: false, text: false };
    case 'bank_cards':
      return { idNumber: true, selfie: false, images: false, text: true };
    case 'phone':
    case 'laptop':
      return { serialOrImage: true, idNumber: false, selfie: false, images: false, text: false };
    case 'wallet':
    case 'bag':
      return { text: true, images: false, idNumber: false, selfie: false };
    default:
      return { textOrImage: true, idNumber: false, selfie: false };
  }
}

export const isCategory = (c) => CATEGORIES.includes(c);
